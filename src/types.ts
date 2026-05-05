export type Summary = {
  tldr: string
  thesis: string
  arguments: string[]
  takeaway: string
}

export type Video = {
  id: string
  title: string
  url: string
  publishedAt: string
  thumbnail: string
  durationSec?: number
  summary: Summary | null
  summarizedAt?: string
  _noTranscript?: boolean
  _error?: string
}

export type ChannelData = {
  channelId: string
  channelName: string
  handle?: string
  slug: string
  lastUpdate: string
  videos: Video[]
}

export type ChannelIndexEntry = {
  slug: string
  name: string
  handle?: string
}
