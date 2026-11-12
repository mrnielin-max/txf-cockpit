'use client'

import { useEffect, useState } from 'react'

interface AnalysisData {
  code: string
  name: string
  price: number
  changePct: number
  generatedAt: string
  macro: string
  technical: string
  advice: string
}

interface Props {
  code: string
  market: string
  price: number
  open: number
  high: number
  low: number
  prev: number
  changePct: number
  volume: number
  name: string
}

export default function AnalysisPanel({ code, market, price, open, high, low, prev, changePct, volume, name }: Props) {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!code || !price) return
    setLoading(true)
    setData(null)

    const params = new URLSearchParams({
      code, market, name,
      price: String(price),
      open: String(open),
      high: String(high),
      low: String(low),
      prev: String(prev),
      changePct: String(changePct),
      volume: String(volume),
    })

    fetch(`/api/analysis?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [code, price])

  const getAdviceColor = () => {
    if (changePct <= -5) return 'border-red-500/40 bg-red-500/5'
    if (changePct >= 5) return 'border-green-500/40 bg-green-500/5'
    return 'border-yellow-500/40 bg-yellow-500/5'
  }

  const getAdviceLabel = () => {
    if (changePct <= -5) return { text: '⚠️ 高風險警示：今日重挫，建議觀望', color: 'text-red-400' }
    if (changePct >= 5) return { text: '🚀 強勢格局：注意追高風險', color: 'text-green-400' }
    return { text: '📋 操作策略參考', color: 'text-yellow-400' }
  }

  const formatText = (text: string) =>
    text.split('\n\n').map((para, i) => (
      <p key={i} className="mb-3 last:mb-0 leading-relaxed text-gray-300 text-sm">
        {para}
      </p>
    ))

  return (
    <div className="bg-[#161b22] rounded-xl border border-[#30363d] overflow-hidden mb-6">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">AI 分析評論</span>
          <span className="text-xs text-gray-500 bg-[#0d1117] px-2 py-0.5 rounded-full">即時生成</span>
        </div>
        {data && (
          <span className="text-xs text-gray-600">{data.generatedAt}</span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <span className="ml-3 text-gray-500 text-sm">正在分析中...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && !data && (
        <div className="flex items-center justify-center py-12 text-gray-600 text-sm">
          請查詢股票以取得分析
        </div>
      )}

      {/* Content - 垂直排列三區塊 */}
      {!loading && data && (
        <div className="divide-y divide-[#30363d]">

          {/* 宏觀經濟 */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🌍</span>
              <span className="text-white font-semibold text-sm">宏觀經濟</span>
              <span className="text-xs text-gray-600 ml-1">全球環境 × 產業背景</span>
            </div>
            {formatText(data.macro)}
          </div>

          {/* 技術面 */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">📊</span>
              <span className="text-white font-semibold text-sm">技術面分析</span>
              <span className="text-xs text-gray-600 ml-1">K線型態 × 支撐壓力 × 量能</span>
            </div>
            {formatText(data.technical)}
          </div>

          {/* 投資建議 */}
          <div className={`p-4 border-l-4 ${getAdviceColor()}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">💡</span>
              <span className="text-white font-semibold text-sm">投資建議</span>
              <span className={`text-xs font-medium ${getAdviceLabel().color}`}>{getAdviceLabel().text}</span>
            </div>
            {formatText(data.advice)}
          </div>

        </div>
      )}
    </div>
  )
}
