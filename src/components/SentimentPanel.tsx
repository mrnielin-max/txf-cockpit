'use client'

import { useEffect, useState } from 'react'

interface SentimentItem {
  id: string
  source: string
  author: string
  content: string
  sentiment: 'positive' | 'negative' | 'neutral'
  score: number
  time: string
  url?: string
}

interface SentimentStats {
  total: number
  positive: number
  negative: number
  neutral: number
  avgScore: number
  overallSentiment: string
  sentimentColor: string
}

interface Props {
  code: string
  name: string
  market: string
  changePct: number
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `${d}天前`
  if (h > 0) return `${h}小時前`
  return '剛剛'
}

export default function SentimentPanel({ code, name, market, changePct }: Props) {
  const [items, setItems] = useState<SentimentItem[]>([])
  const [stats, setStats] = useState<SentimentStats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!code) return
    setLoading(true)
    const params = new URLSearchParams({ code, name, market, changePct: String(changePct) })
    fetch(`/api/sentiment?${params}`)
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setStats(d.stats || null) })
      .finally(() => setLoading(false))
  }, [code])

  const sentimentIcon = (s: string) =>
    s === 'positive' ? '🟢' : s === 'negative' ? '🔴' : '🟡'
  const sentimentBg = (s: string) =>
    s === 'positive' ? 'rgba(63,185,80,0.08)' : s === 'negative' ? 'rgba(248,81,73,0.08)' : 'rgba(227,179,65,0.06)'
  const sentimentBorder = (s: string) =>
    s === 'positive' ? '#3fb950' : s === 'negative' ? '#f85149' : '#e3b341'

  return (
    <div style={{ background: '#161b22', borderRadius: 12, border: '1px solid #30363d', overflow: 'hidden', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>💬</span>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>市場留言情緒分析</span>
        <span style={{ color: '#8b949e', fontSize: 13, marginLeft: 4 }}>最少 15 則多來源評論</span>
      </div>

      {loading && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#8b949e' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⟳</div>
          正在蒐集市場留言...
        </div>
      )}

      {!loading && stats && (
        <>
          {/* 情緒統計條 */}
          <div style={{ padding: '16px 18px', borderBottom: '1px solid #21262d', background: '#0d1117' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{
                fontSize: 22, fontWeight: 800, color: stats.sentimentColor,
                padding: '4px 14px', borderRadius: 8, background: `${stats.sentimentColor}18`,
                border: `1px solid ${stats.sentimentColor}40`,
              }}>
                {stats.overallSentiment}
              </div>
              <div style={{ color: '#8b949e', fontSize: 14 }}>
                綜合情緒分數：
                <span style={{ color: stats.sentimentColor, fontWeight: 700, fontSize: 18, marginLeft: 4 }}>
                  {stats.avgScore > 0 ? '+' : ''}{stats.avgScore}
                </span>
                <span style={{ fontSize: 12, marginLeft: 4 }}>/ ±100</span>
              </div>
            </div>

            {/* 情緒比例條 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[
                { label: `🟢 看多 ${stats.positive}`, pct: stats.positive / stats.total * 100, color: '#3fb950' },
                { label: `🟡 中性 ${stats.neutral}`, pct: stats.neutral / stats.total * 100, color: '#e3b341' },
                { label: `🔴 看空 ${stats.negative}`, pct: stats.negative / stats.total * 100, color: '#f85149' },
              ].map(item => (
                <div key={item.label} style={{ flex: `0 0 ${item.pct}%`, height: 8, background: item.color, borderRadius: 4 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[
                { label: `🟢 看多`, val: stats.positive, color: '#3fb950' },
                { label: `🟡 中性`, val: stats.neutral, color: '#e3b341' },
                { label: `🔴 看空`, val: stats.negative, color: '#f85149' },
              ].map(item => (
                <span key={item.label} style={{ color: item.color, fontSize: 13 }}>
                  {item.label} <strong>{item.val}</strong>則
                </span>
              ))}
              <span style={{ color: '#8b949e', fontSize: 13 }}>共 {stats.total} 則</span>
            </div>
          </div>

          {/* 留言列表 */}
          <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((item, i) => (
              <div key={item.id} style={{
                background: sentimentBg(item.sentiment),
                border: `1px solid ${sentimentBorder(item.sentiment)}30`,
                borderLeft: `3px solid ${sentimentBorder(item.sentiment)}`,
                borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: '#8b949e', fontSize: 12, fontWeight: 700 }}>#{i + 1}</span>
                  <span style={{ color: '#f97316', fontSize: 12, fontWeight: 600,
                    background: '#f9731615', padding: '1px 8px', borderRadius: 4 }}>
                    {item.source}
                  </span>
                  <span style={{ color: '#58a6ff', fontSize: 12 }}>@{item.author}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8b949e' }}>{timeAgo(item.time)}</span>
                  <span style={{ fontSize: 14 }}>{sentimentIcon(item.sentiment)}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: sentimentBorder(item.sentiment),
                    minWidth: 32, textAlign: 'right',
                  }}>
                    {item.score > 0 ? '+' : ''}{item.score}
                  </span>
                </div>
                <div style={{ color: '#e6edf3', fontSize: 14, lineHeight: 1.6 }}>
                  {item.url
                    ? <a href={item.url} target="_blank" rel="noreferrer"
                        style={{ color: '#e6edf3', textDecoration: 'none' }}>
                        {item.content}
                      </a>
                    : item.content}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
