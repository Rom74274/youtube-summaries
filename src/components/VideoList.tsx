import type { ChannelData } from '../types'
import { VideoCard } from './VideoCard'

export function VideoList({ channel }: { channel: ChannelData }) {
  const lastUpdate = new Date(channel.lastUpdate).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  return (
    <section className="video-list">
      <header className="list-header">
        <div>
          <h2>{channel.channelName}</h2>
          <p className="muted">
            {channel.videos.length} vidéo{channel.videos.length > 1 ? 's' : ''} · MAJ {lastUpdate}
          </p>
        </div>
      </header>
      {channel.videos.length === 0 ? (
        <p className="empty">Aucune vidéo à afficher.</p>
      ) : (
        <div className="cards">
          {channel.videos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </section>
  )
}
