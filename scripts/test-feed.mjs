// Dry-run: pour chaque chaîne, montre les candidats top 4 ≥ 20 min sans appeler Claude.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Parser from 'rss-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const channels = JSON.parse(readFileSync(resolve(ROOT, 'channels.json'), 'utf8'))
const rss = new Parser()
const DEFAULT_MIN = 20 * 60
const TOP = 4

async function getDuration(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const t = await r.text()
    const m = t.match(/"lengthSeconds":"(\d+)"/)
    return m ? parseInt(m[1], 10) : null
  } catch {
    return null
  }
}

const fmt = (s) => (s ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : '?')

for (const ch of channels) {
  const min = ch.minDurationSec ?? DEFAULT_MIN
  console.log(`\n=== ${ch.name} (${ch.handle}) — min ${min / 60}m ===`)
  const feed = await rss.parseURL(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`,
  )
  const sorted = feed.items
    .filter((e) => !e.link?.includes('/shorts/'))
    .sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate))
  let kept = 0
  for (const e of sorted) {
    if (kept >= TOP) break
    const id = e.id.replace('yt:video:', '')
    const dur = await getDuration(id)
    if (dur == null) {
      console.log(`  ?      skip   ${id}  ${e.title.slice(0, 70)}`)
      continue
    }
    if (dur < min) {
      console.log(`  ${fmt(dur).padStart(7)} short  ${id}  ${e.title.slice(0, 70)}`)
      continue
    }
    console.log(`  ${fmt(dur).padStart(7)} ✓ KEEP ${id}  ${e.title.slice(0, 70)}`)
    kept++
  }
  console.log(`  → ${kept}/${TOP} candidates`)
}
