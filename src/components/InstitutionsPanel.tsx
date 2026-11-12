'use client';
import { useEffect, useState } from 'react';

interface Row { name: string; buy: string; sell: string; net: string; }

function parseNum(s: string) {
  return parseInt((s || '0').replace(/,/g, ''), 10);
}

/* 元 → 格式化（億 or 兆）
 * TWSE API 單位：元
 * 1億 = 100,000,000 元
 * 1兆 = 10,000億 = 1,000,000,000,000 元
 */
function fmtYuan(n: number): { value: string; unit: string } {
  const yi = n / 100_000_000;          // 元 → 億
  if (Math.abs(yi) >= 10_000) {
    // ≥ 1兆 → 顯示兆（保留3位小數）
    const zhao = yi / 10_000;
    return { value: zhao.toFixed(3), unit: '兆' };
  }
  return { value: yi.toFixed(1), unit: '億' };
}

function fmtNet(n: number): string {
  const { value, unit } = fmtYuan(Math.abs(n));
  return `${n >= 0 ? '+' : '-'}${value}${unit}元`;
}

export default function InstitutionsPanel() {
  const [rows,    setRows]    = useState<Row[]>([]);
  const [date,    setDate]    = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/institutions')
      .then(r => r.json())
      .then(d => { setRows(d.rows || []); setDate(d.date || ''); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: 16 }}>
      {/* 標題 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ borderLeft: '3px solid #f97316', paddingLeft: 10, color: '#e6edf3', fontWeight: 700, fontSize: 17 }}>
          🏦 三大法人
        </div>
        {date && <span style={{ color: '#6b7280', fontSize: 13 }}>{date}</span>}
      </div>

      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 15 }}>載入中...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 15 }}>今日無資料（非交易日）</div>
      ) : (
        rows.map(r => {
          const net  = parseNum(r.net);
          const buy  = parseNum(r.buy);
          const sell = parseNum(r.sell);
          const isBuy = net >= 0;
          const clr   = isBuy ? '#ef4444' : '#22c55e';
          const label = isBuy ? '買超' : '賣超';

          const netFmt  = fmtYuan(Math.abs(net));
          const buyFmt  = fmtYuan(buy);
          const sellFmt = fmtYuan(sell);

          return (
            <div key={r.name} style={{
              marginBottom: 14, padding: '14px 14px',
              background: '#0d1117', borderRadius: 8,
              border: `1px solid ${isBuy ? '#ef444430' : '#22c55e30'}`,
            }}>
              {/* 機構名稱 + 買超/賣超標籤 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#e6edf3', fontSize: 16, fontWeight: 700 }}>{r.name}</span>
                <span style={{
                  background: isBuy ? '#ef444420' : '#22c55e20',
                  color: clr, fontSize: 13, fontWeight: 800,
                  padding: '3px 10px', borderRadius: 20,
                  border: `1px solid ${clr}`,
                }}>
                  {label}
                </span>
              </div>

              {/* 淨買超 — 大字 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                <span style={{ color: clr, fontSize: 30, fontWeight: 900, letterSpacing: -1 }}>
                  {isBuy ? '+' : '-'}{netFmt.value}
                </span>
                <span style={{ color: '#8b949e', fontSize: 15 }}>{netFmt.unit}元</span>
              </div>

              {/* 買入 / 賣出 明細 */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 2 }}>買入</div>
                  <div style={{ color: '#ef4444', fontSize: 16, fontWeight: 700 }}>
                    {buyFmt.value} <span style={{ fontSize: 12, color: '#8b949e' }}>{buyFmt.unit}</span>
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid #21262d', paddingLeft: 20 }}>
                  <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 2 }}>賣出</div>
                  <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 700 }}>
                    {sellFmt.value} <span style={{ fontSize: 12, color: '#8b949e' }}>{sellFmt.unit}</span>
                  </div>
                </div>
              </div>

              {/* 進度條 — 以淨買超相對外資總量縮放 */}
              <div style={{ height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.abs(net) / 50_000_000_000 * 100)}%`,
                  background: clr, borderRadius: 3, transition: 'width 0.6s',
                }} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
