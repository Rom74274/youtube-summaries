import { useState } from 'react'
import type { Video } from '../types'
import { formatDate, formatDuration } from '../lib/data'
import { SummaryView } from './SummaryView'

export function VideoCard({ video }: { video: Video }) {
  const [open, setOpen] = useState(false)
  const hasSummary = !!video.summary
  const status = video._noTranscript
    ? 'Sans sous-titres'
    : video._error
      ? 'Erreur'
      : !hasSummary
        ? '—'
        : null

  return (
    <article className={`video-card ${open ? 'is-open' : ''}`}>
      <button
        className="video-card-head"
        onClick={() => hasSummary && setOpen(!open)}
        disabled={!hasSummary}
      >
        <img className="thumb" src={video.thumbnail} alt="" loading="lazy" />
        <div className="meta">
          <h3>{video.title}</h3>
          <div className="sub">
            <time>{formatDate(video.publishedAt)}</time>
            {formatDuration(video.durationSec) && (
              <span className="badge">{formatDuration(video.durationSec)}</span>
            )}
            {status && <span className="badge">{status}</span>}
          </div>
          {hasSummary && <p className="tldr">{video.summary!.tldr}</p>}
        </div>
        {hasSummary && <span className="chevron" aria-hidden>{open ? '▾' : '▸'}</span>}
      </button>
      {open && hasSummary && (
        <div className="video-card-body">
          <SummaryView summary={video.summary!} />
          <a className="watch" href={video.url} target="_blank" rel="noopener noreferrer">
            ▶ Voir la vidéo sur YouTube
          </a>
        </div>
      )}
    </article>
  )
}
