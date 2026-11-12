'use client'

import { useEffect, useState } from 'react'

interface CalendarEvent {
  date: string
  title: string
  type: 'earnings' | 'dividend' | 'fed' | 'economic' | 'market' | 'stock'
  impact: 'high' | 'medium' | 'low'
  description: string
  time?: string
}

interface Props {
  code: string
  name: string
  market: string
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  earnings:  { icon: '📋', color: '#f97316', label: '法說會/財報' },
  dividend:  { icon: '💰', color: '#3fb950', label: '股利事件' },
  fed:       { icon: '🏦', color: '#f85149', label: '央行決策' },
  economic:  { icon: '📊', color: '#58a6ff', label: '經濟數據' },
  market:    { icon: '📅', color: '#e3b341', label: '市場事件' },
  stock:     { icon: '📌', color: '#a371f7', label: '個股事件' },
}

const IMPACT_CONFIG: Record<string, { label: string; color: string }> = {
  high:   { label: '高度影響', color: '#f85149' },
  medium: { label: '中度影響', color: '#e3b341' },
  low:    { label: '低度影響', color: '#8b949e' },
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  const wd = weekdays[d.getDay()]

  if (diff === 0) return `今天 (${wd})`
  if (diff === 1) return `明天 (${wd})`
  if (diff === 2) return `後天 (${wd})`
  return `${d.getMonth() + 1}/${d.getDate()} (${wd}) — ${diff}天後`
}

export default function CalendarPanel({ code, name, market }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!code) return
    setLoading(true)
    const params = new URLSearchParams({ code, name, market })
    fetch(`/api/calendar?${params}`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .finally(() => setLoading(false))
  }, [code])

  const highImpact = events.filter(e => e.impact === 'high')
  const others = events.filter(e => e.impact !== 'high')

  return (
    <div style={{ background: '#161b22', borderRadius: 12, border: '1px solid #30363d', overflow: 'hidden', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>🗓️</span>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>15 日重大行事曆</span>
        <span style={{ color: '#8b949e', fontSize: 13 }}>法說會・央行・經濟數據・市場結算</span>
        {events.length > 0 && (
          <span style={{
            marginLeft: 'auto', background: '#f97316', color: '#fff',
            fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 12,
          }}>
            {events.length} 個事件
          </span>
        )}
      </div>

      {loading && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#8b949e' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⟳</div>
          載入行事曆...
        </div>
      )}

      {!loading && events.length === 0 && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#8b949e', fontSize: 14 }}>
          15日內無重大排程事件
        </div>
      )}

      {!loading && events.length > 0 && (
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* 高影響事件優先 */}
          {highImpact.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ color: '#f85149', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
                ⚡ 高度影響事件
              </div>
              {highImpact.map((e, i) => (
                <EventCard key={i} event={e} />
              ))}
            </div>
          )}

          {/* 其他事件 */}
          {others.length > 0 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 12, fontWeight: 700, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
                📌 其他市場事件
              </div>
              {others.map((e, i) => (
                <EventCard key={i} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EventCard({ event }: { event: CalendarEvent }) {
  const tc = TYPE_CONFIG[event.type] || TYPE_CONFIG.market
  const ic = IMPACT_CONFIG[event.impact]

  return (
    <div style={{
      background: '#0d1117', border: `1px solid #21262d`,
      borderLeft: `3px solid ${tc.color}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 8,
    }}>
      {/* 上行：日期 + 類型 + 影響度 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14 }}>
          {formatDate(event.date)}
        </span>
        {event.time && (
          <span style={{ color: '#8b949e', fontSize: 12 }}>· {event.time}</span>
        )}
        <span style={{
          background: `${tc.color}20`, color: tc.color,
          fontSize: 12, padding: '1px 8px', borderRadius: 4, fontWeight: 600,
        }}>
          {tc.icon} {tc.label}
        </span>
        <span style={{
          background: `${ic.color}20`, color: ic.color,
          fontSize: 11, padding: '1px 7px', borderRadius: 4, marginLeft: 'auto',
        }}>
          {ic.label}
        </span>
      </div>

      {/* 標題 */}
      <div style={{ color: '#e6edf3', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        {event.title}
      </div>

      {/* 說明 */}
      <div style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.65 }}>
        {event.description}
      </div>
    </div>
  )
}
