'use client';
import { useEffect, useState } from 'react';

interface Factor {
  symbol: string; name: string; group: string; txfKey: boolean;
  price: number; change: number; changePct: number; ok: boolean; currency?: string;
}

const up = '#ef4444', down = '#22c55e';

export default function GlobalPulse() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [tsmImplied, setTsmImplied] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/global-pulse').then(r => r.json())
      .then(d => { if (alive) { setFactors(d.factors || []); setTsmImplied(d.tsmImplied || 0); } })
      .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const keyFactors = factors.filter(f => f.txfKey);
  const otherFactors = factors.filter(f => !f.txfKey);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="panel-title">🌍 海外脈動 · 影響台指期的外盤因子</div>
      {tsmImplied > 0 && (
        <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 10 }}>
          TSM ADR 折算 2330 隱含價：<b style={{ color: '#e6edf3' }}>{tsmImplied.toLocaleString()} 元</b>
          （ADR × USDTWD ÷ 5；隔日台指期開盤方向主要預測器）
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
        {keyFactors.map(f => <FactorCard key={f.symbol} f={f} highlight />)}
      </div>
      {otherFactors.length > 0 && (
        <>
          <div style={{ color: '#8b949e', fontSize: 12, margin: '14px 0 8px' }}>其他參考</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {otherFactors.map(f => <FactorCard key={f.symbol} f={f} />)}
          </div>
        </>
      )}
    </div>
  );
}

function FactorCard({ f, highlight }: { f: Factor; highlight?: boolean }) {
  const color = f.changePct > 0 ? up : f.changePct < 0 ? down : '#e6edf3';
  return (
    <div style={{
      background: '#0d1117', borderRadius: 8, padding: '10px 12px',
      border: highlight ? '1px solid #30363d' : '1px solid #21262d',
    }}>
      <div style={{ color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {f.name}
      </div>
      <div style={{ color, fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
        {f.ok ? f.price.toLocaleString() : '--'}
      </div>
      <div style={{ color, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {f.ok ? `${f.changePct > 0 ? '+' : ''}${f.changePct.toFixed(2)}%` : ''}
      </div>
    </div>
  );
}
