import type { ChannelIndexEntry } from '../types'

type Props = {
  channels: ChannelIndexEntry[]
  selected: string | null
  onSelect: (slug: string) => void
}

export function ChannelMenu({ channels, selected, onSelect }: Props) {
  return (
    <nav className="channel-menu" aria-label="Chaînes">
      {channels.map((c) => (
        <button
          key={c.slug}
          className={`channel-btn ${selected === c.slug ? 'is-active' : ''}`}
          onClick={() => onSelect(c.slug)}
        >
          {c.name}
        </button>
      ))}
    </nav>
  )
}
