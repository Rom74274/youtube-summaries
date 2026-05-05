import type { Summary } from '../types'

// Rend les **gras** des arguments en <strong>
function renderInline(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  const regex = /\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(<strong key={key++}>{match[1]}</strong>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

export function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div className="summary">
      <section>
        <h4>Thèse centrale</h4>
        <p>{summary.thesis}</p>
      </section>
      <section>
        <h4>Arguments clés</h4>
        <ul>
          {summary.arguments.map((a, i) => (
            <li key={i}>{renderInline(a)}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>À retenir</h4>
        <p>{summary.takeaway}</p>
      </section>
    </div>
  )
}
