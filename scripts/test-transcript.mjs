// Dry-run: vérifie qu'on récupère bien le RSS et le transcript de la dernière vidéo NON-Short.
// Aucun appel Claude. Usage: node scripts/test-transcript.mjs
import Parser from 'rss-parser'
import { YoutubeTranscript } from 'youtube-transcript'

const CHANNEL_ID = 'UCtJuE2ar0ptD5b12ueCMq1w'

const rss = new Parser()
const feed = await rss.parseURL(
  `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
)

console.log(`Feed: ${feed.title} — ${feed.items.length} entries`)

let tested = 0
for (const entry of feed.items) {
  if (entry.link?.includes('/shorts/')) continue
  const videoId = entry.id.replace('yt:video:', '')
  console.log(`\n→ ${videoId} | ${entry.title}`)
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'fr' })
    if (!segs?.length) {
      console.log('  ⚠ no transcript segments')
      continue
    }
    const text = segs
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
    console.log(`  ✓ transcript: ${segs.length} segments, ${text.length} chars`)
    console.log(`  preview: "${text.slice(0, 200)}..."`)
    tested++
  } catch (e) {
    console.log(`  ✗ ${e.message}`)
  }
  if (tested >= 2) break
}
console.log(`\nDone. ${tested} transcripts fetched successfully.`)
