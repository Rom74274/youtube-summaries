import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'rss-parser'
import { YoutubeTranscript } from 'youtube-transcript'
import { Innertube } from 'youtubei.js'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public/data')

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_OUTPUT_TOKENS = 2000
const FEED_SIZE = 4
const DEFAULT_MIN_DURATION_SEC = 20 * 60
const MAX_TRANSCRIPT_CHARS = 250_000

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('Missing ANTHROPIC_API_KEY env var')
  process.exit(1)
}
const anthropic = new Anthropic({ apiKey })

const channels = JSON.parse(readFileSync(resolve(ROOT, 'channels.json'), 'utf8'))
const rssParser = new Parser()

let _yt
async function yt() {
  if (!_yt) _yt = await Innertube.create({ lang: 'fr', location: 'FR' })
  return _yt
}

const SYSTEM_PROMPT = `Tu reçois la transcription d'une vidéo YouTube (en français). Produis un résumé structuré au format JSON STRICT.

⚠️ IGNORE TOTALEMENT :
- Les passages promotionnels, sponsoring, partenariats
- Les appels à l'action ("abonnez-vous", "likez", "cliquez")
- La vente de formations, masterclass, livres, codes promo
- Les introductions/outros génériques

Concentre-toi UNIQUEMENT sur le contenu de fond (idées, analyses, arguments).

Schéma de sortie:
{
  "tldr": "2-3 phrases qui résument l'essentiel du contenu de fond",
  "thesis": "L'idée principale ou l'angle défendu par l'auteur (1-2 phrases)",
  "arguments": [
    "Argument 1: 2-3 phrases détaillées. Si un concept technique, une loi ou une théorie est abordé, intègre-le directement dans l'explication en le mettant en avant (par exemple en gras avec **).",
    "Argument 2: 2-3 phrases détaillées.",
    "...5 à 7 arguments au total"
  ],
  "takeaway": "La conclusion du sujet abordé (sans aucune mention promotionnelle)"
}

Règles strictes:
- Réponds UNIQUEMENT avec le JSON, sans texte autour, sans \`\`\`json.
- "arguments" doit contenir entre 5 et 7 strings, chacun de 2-3 phrases détaillées.
- Si le contenu est mince, mets "—" pour les champs concernés mais respecte le schéma.
- Garde le ton et la perspective du locuteur, ne juge pas.
- Pas de markdown sauf **gras** pour mettre en avant les concepts/théories/lois dans les arguments.`

// Durée: via Innertube (marche depuis IPs cloud, contrairement au scrape HTML)
async function fetchDurationSec(videoId) {
  try {
    const innertube = await yt()
    const info = await innertube.getBasicInfo(videoId)
    return info?.basic_info?.duration ?? null
  } catch (e) {
    return null
  }
}

// Transcript: cascade de stratégies
async function fetchTranscriptText(videoId) {
  // Stratégie 1: youtube-transcript (marche en local, parfois bloqué sur cloud)
  for (const lang of ['fr', undefined]) {
    try {
      const segs = await YoutubeTranscript.fetchTranscript(
        videoId,
        lang ? { lang } : undefined,
      )
      if (segs?.length) {
        return segs
          .map((s) => s.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
    } catch {
      // try next
    }
  }
  // Stratégie 2: youtubei.js getTranscript (parfois 400 mais on tente)
  try {
    const innertube = await yt()
    const info = await innertube.getInfo(videoId)
    const tr = await info.getTranscript()
    const segs = tr?.transcript?.content?.body?.initial_segments
    if (segs?.length) {
      return segs
        .map((s) => s.snippet?.text || '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    }
  } catch {
    // give up
  }
  return null
}

async function summarize(transcript, title) {
  const truncated =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) +
        '\n[…transcript tronqué pour limiter le coût]'
      : transcript
  const userPrompt = `Titre: ${title}\n\nTranscription:\n${truncated}`
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned)
  return {
    summary: parsed,
    usage: {
      input_tokens: resp.usage.input_tokens,
      output_tokens: resp.usage.output_tokens,
    },
  }
}

function isShort(entry) {
  return Boolean(entry.link?.includes('/shorts/'))
}

function videoIdFromEntry(entry) {
  return entry.id?.replace('yt:video:', '') || entry.link?.match(/[?&]v=([^&]+)/)?.[1]
}

function fmtMin(s) {
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`
}

async function processChannel(channel) {
  console.log(`\n=== ${channel.name} (${channel.slug}) ===`)
  const dataPath = resolve(DATA_DIR, `${channel.slug}.json`)
  const existing = existsSync(dataPath)
    ? JSON.parse(readFileSync(dataPath, 'utf8'))
    : { videos: [] }
  const minDuration = channel.minDurationSec ?? DEFAULT_MIN_DURATION_SEC

  // 1. RSS, filtre Shorts, sort by date desc
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`
  const feed = await rssParser.parseURL(feedUrl)
  const sorted = feed.items
    .filter((entry) => !isShort(entry))
    .map((entry) => ({
      entry,
      videoId: videoIdFromEntry(entry),
      publishedAt: entry.isoDate || entry.pubDate,
    }))
    .filter((c) => c.videoId)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

  // 2. Pour chaque nouvelle vidéo: fetch durée, filtrer
  const existingById = new Map(existing.videos.map((v) => [v.id, v]))
  const newCandidates = []
  for (const c of sorted) {
    if (existingById.has(c.videoId)) continue
    const duration = await fetchDurationSec(c.videoId)
    if (duration == null) {
      console.log(`  • ?       no duration  ${c.videoId}  ${c.entry.title.slice(0, 60)}`)
      continue
    }
    if (duration < minDuration) {
      console.log(
        `  • ${fmtMin(duration).padStart(7)} too short  ${c.videoId}  ${c.entry.title.slice(0, 60)}`,
      )
      continue
    }
    console.log(
      `  • ${fmtMin(duration).padStart(7)} NEW         ${c.videoId}  ${c.entry.title.slice(0, 60)}`,
    )
    newCandidates.push({ ...c, duration })
  }

  // 3. Pool = anciennes résumées + nouvelles candidates, sort by date desc
  const existingWithSummary = existing.videos.filter((v) => v.summary)
  const pool = [
    ...existingWithSummary.map((v) => ({
      kind: 'existing',
      data: v,
      publishedAt: v.publishedAt,
    })),
    ...newCandidates.map((c) => ({ kind: 'new', data: c, publishedAt: c.publishedAt })),
  ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

  const top = pool.slice(0, FEED_SIZE)
  console.log(
    `  pool: ${existingWithSummary.length} existing + ${newCandidates.length} new → top ${top.length}`,
  )

  // 4. Pour chaque élément du top: KEEP si existant, SUMMARIZE si nouveau
  const videos = []
  let processedThisRun = 0
  const totalUsage = { input_tokens: 0, output_tokens: 0 }

  for (const item of top) {
    if (item.kind === 'existing') {
      console.log(`  • KEEP         ${item.data.id}  ${item.data.title.slice(0, 60)}`)
      videos.push(item.data)
      continue
    }
    const c = item.data
    console.log(`  • SUMMARIZE    ${c.videoId}  ${c.entry.title.slice(0, 60)}`)
    const transcript = await fetchTranscriptText(c.videoId)
    if (!transcript) {
      console.log(`    no transcript — keeping in feed without summary`)
      videos.push({
        id: c.videoId,
        title: c.entry.title,
        url: `https://www.youtube.com/watch?v=${c.videoId}`,
        publishedAt: c.publishedAt,
        thumbnail: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
        durationSec: c.duration,
        summary: null,
        _noTranscript: true,
      })
      continue
    }
    try {
      const { summary, usage } = await summarize(transcript, c.entry.title)
      totalUsage.input_tokens += usage.input_tokens
      totalUsage.output_tokens += usage.output_tokens
      const cost =
        (usage.input_tokens * 1) / 1_000_000 + (usage.output_tokens * 5) / 1_000_000
      console.log(
        `    ✓ in=${usage.input_tokens} out=${usage.output_tokens} cost≈$${cost.toFixed(4)}`,
      )
      videos.push({
        id: c.videoId,
        title: c.entry.title,
        url: `https://www.youtube.com/watch?v=${c.videoId}`,
        publishedAt: c.publishedAt,
        thumbnail: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
        durationSec: c.duration,
        summary,
        summarizedAt: new Date().toISOString(),
      })
      processedThisRun++
    } catch (e) {
      console.warn(`    ✗ summary failed: ${e.message}`)
      videos.push({
        id: c.videoId,
        title: c.entry.title,
        url: `https://www.youtube.com/watch?v=${c.videoId}`,
        publishedAt: c.publishedAt,
        thumbnail: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
        durationSec: c.duration,
        summary: null,
        _error: e.message,
      })
    }
  }

  const totalCost =
    (totalUsage.input_tokens * 1) / 1_000_000 + (totalUsage.output_tokens * 5) / 1_000_000
  if (processedThisRun === 0) {
    console.log(`  → no new summaries`)
  } else {
    console.log(
      `  → ${processedThisRun} new summaries, total cost this run ≈ $${totalCost.toFixed(4)}`,
    )
  }

  const out = {
    channelId: channel.channelId,
    channelName: channel.name,
    handle: channel.handle,
    slug: channel.slug,
    lastUpdate: new Date().toISOString(),
    videos,
  }
  writeFileSync(dataPath, JSON.stringify(out, null, 2))
  console.log(`  → wrote ${dataPath}`)
  return { processed: processedThisRun, cost: totalCost }
}

async function main() {
  console.log(`Found ${channels.length} channel(s)`)
  let grandTotalCost = 0
  let grandProcessed = 0
  for (const ch of channels) {
    const { processed, cost } = await processChannel(ch)
    grandTotalCost += cost
    grandProcessed += processed
  }
  const indexPath = resolve(DATA_DIR, 'index.json')
  writeFileSync(
    indexPath,
    JSON.stringify(
      channels.map((c) => ({ slug: c.slug, name: c.name, handle: c.handle })),
      null,
      2,
    ),
  )
  console.log(`\n=== DONE ===`)
  console.log(`Total: ${grandProcessed} summaries, cost ≈ $${grandTotalCost.toFixed(4)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
