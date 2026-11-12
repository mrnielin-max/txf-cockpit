'use client';

import { StockQuote } from '@/types/stock';

interface Props {
  quote: StockQuote;
}

export default function QuoteCard({ quote }: Props) {
  const isUp  = quote.change >= 0;
  const sign  = isUp ? '+' : '';
  const color = isUp ? 'text-[#3fb950]' : 'text-[#f85149]';
  const arrow = isUp ? '▲' : '▼';

  const items = [
    { label: '開盤價',    value: quote.open.toFixed(2) },
    { label: '最高價',    value: quote.high.toFixed(2) },
    { label: '最低價',    value: quote.low.toFixed(2)  },
    { label: '昨日收盤',  value: quote.prev.toFixed(2) },
    { label: '成交量',    value: quote.market === 'US'
        ? `${(quote.volume / 1_000_000).toFixed(2)}M`
        : `${quote.volume.toLocaleString()} 張` },
    { label: '市場',      value: quote.market },
  ];

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 mb-6">
      {/* 頭部 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="text-2xl font-bold text-[#58a6ff]">{quote.code}</div>
          <div className="text-[#8b949e] mt-1">{quote.name}</div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${color}`}>{quote.price.toFixed(2)}</div>
          <div className={`mt-1 ${color}`}>
            {arrow} {sign}{quote.change.toFixed(2)} ({sign}{quote.changePct.toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* 數據格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map(item => (
          <div key={item.label} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3">
            <div className="text-xs text-[#8b949e] mb-1 uppercase tracking-wide">{item.label}</div>
            <div className="text-lg font-bold text-[#e6edf3]">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="text-right text-xs text-[#8b949e] mt-3">更新時間：{new Date().toLocaleTimeString('zh-TW', { hour12: false })}</div>
    </div>
  );
}
