import { useEffect, useState } from 'react'
import { ChannelMenu } from './components/ChannelMenu'
import { VideoList } from './components/VideoList'
import { fetchChannelData, fetchChannelIndex } from './lib/data'
import type { ChannelData, ChannelIndexEntry } from './types'
import './App.css'

const STORAGE_KEY = 'yt-summaries:lastChannel'

function App() {
  const [index, setIndex] = useState<ChannelIndexEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [channel, setChannel] = useState<ChannelData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchChannelIndex()
      .then((idx) => {
        setIndex(idx)
        const remembered = localStorage.getItem(STORAGE_KEY)
        const initial = idx.find((c) => c.slug === remembered)?.slug ?? idx[0]?.slug
        if (initial) setSelected(initial)
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setError(null)
    setChannel(null)
    localStorage.setItem(STORAGE_KEY, selected)
    fetchChannelData(selected)
      .then(setChannel)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selected])

  return (
    <div className="app">
      <header className="app-header">
        <h1>YouTube Summaries</h1>
        {index && (
          <ChannelMenu channels={index} selected={selected} onSelect={setSelected} />
        )}
      </header>
      <main>
        {error && <p className="error">Erreur: {error}</p>}
        {loading && <p className="muted">Chargement…</p>}
        {channel && <VideoList channel={channel} />}
        {!loading && !channel && !error && index && index.length === 0 && (
          <p className="empty">Aucune chaîne configurée.</p>
        )}
      </main>
    </div>
  )
}

export default App
