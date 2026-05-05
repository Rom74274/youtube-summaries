import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'rss-parser'
import { YoutubeTranscript } from 'youtube-transcript'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public/data')

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_OUTPUT_TOKENS = 2000
const FEED_SIZE = 4 // top N non-Shorts à garder par chaîne
const DEFAULT_MIN_DURATION_SEC = 20 * 60 // seuil global, override possible par chaîne
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

async function fetchTranscript(videoId) {
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
      // try next strategy
    }
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

async function fetchDuration(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/"lengthSeconds":"(\d+)"/)
    return m ? parseInt(m[1], 10) : null
  } catch {
    return null
  }
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

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`
  const feed = await rssParser.parseURL(feedUrl)

  // 1. Filtrer les Shorts, trier par date desc
  const sorted = feed.items
    .filter((entry) => !isShort(entry))
    .map((entry) => ({
      entry,
      videoId: videoIdFromEntry(entry),
      publishedAt: entry.isoDate || entry.pubDate,
    }))
    .filter((c) => c.videoId)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))

  // 2. Garder les FEED_SIZE plus récentes vidéos >= seuil de durée
  const minDuration = channel.minDurationSec ?? DEFAULT_MIN_DURATION_SEC
  const candidates = []
  for (const c of sorted) {
    if (candidates.length >= FEED_SIZE) break
    // Si déjà résumée, on a déjà la durée implicitement (on l'avait gardée)
    const previous = existing.videos.find((v) => v.id === c.videoId)
    let duration = previous?.durationSec
    if (duration == null) {
      duration = await fetchDuration(c.videoId)
    }
    if (duration == null) {
      console.log(`  • ?       (no duration) skip   ${c.videoId}  ${c.entry.title.slice(0, 60)}`)
      continue
    }
    if (duration < minDuration) {
      console.log(
        `  • ${fmtMin(duration).padStart(7)} too short skip ${c.videoId}  ${c.entry.title.slice(0, 60)}`,
      )
      continue
    }
    candidates.push({ ...c, duration })
  }

  console.log(`  ${candidates.length}/${FEED_SIZE} candidate(s) ≥ ${minDuration / 60} min`)

  // 2. Pour chaque candidat, soit on garde l'existant, soit on résume
  const videos = []
  let processedThisRun = 0
  const totalUsage = { input_tokens: 0, output_tokens: 0 }

  for (const { entry, videoId, publishedAt, duration } of candidates) {
    const previous = existing.videos.find((v) => v.id === videoId && v.summary)
    const base = {
      id: videoId,
      title: entry.title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSec: duration,
    }

    if (previous) {
      console.log(`  • KEEP         ${videoId}  ${entry.title.slice(0, 60)}`)
      videos.push({
        ...base,
        summary: previous.summary,
        summarizedAt: previous.summarizedAt,
      })
      continue
    }

    console.log(`  • SUMMARIZE    ${videoId}  ${entry.title.slice(0, 60)}`)
    const transcript = await fetchTranscript(videoId)
    if (!transcript) {
      console.log(`    no transcript available — keeping in feed without summary`)
      videos.push({ ...base, summary: null, _noTranscript: true })
      continue
    }

    try {
      const { summary, usage } = await summarize(transcript, entry.title)
      totalUsage.input_tokens += usage.input_tokens
      totalUsage.output_tokens += usage.output_tokens
      const cost =
        (usage.input_tokens * 1) / 1_000_000 + (usage.output_tokens * 5) / 1_000_000
      console.log(
        `    ✓ in=${usage.input_tokens} out=${usage.output_tokens} cost≈$${cost.toFixed(4)}`,
      )
      videos.push({ ...base, summary, summarizedAt: new Date().toISOString() })
      processedThisRun++
    } catch (e) {
      console.warn(`    ✗ summary failed: ${e.message}`)
      videos.push({ ...base, summary: null, _error: e.message })
    }
  }

  const totalCost =
    (totalUsage.input_tokens * 1) / 1_000_000 + (totalUsage.output_tokens * 5) / 1_000_000

  if (processedThisRun === 0) {
    console.log(`  → no new videos to summarize`)
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
