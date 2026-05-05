import type { ChannelData, ChannelIndexEntry } from '../types'

const BASE = import.meta.env.BASE_URL

export async function fetchChannelIndex(): Promise<ChannelIndexEntry[]> {
  const r = await fetch(`${BASE}data/index.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`index.json: ${r.status}`)
  return r.json()
}

export async function fetchChannelData(slug: string): Promise<ChannelData> {
  const r = await fetch(`${BASE}data/${slug}.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`${slug}.json: ${r.status}`)
  return r.json()
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDuration(sec?: number): string | null {
  if (!sec) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
}
