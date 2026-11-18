'use client';
import { useEffect, useState } from 'react';

interface SessionInfo { state: 'open' | 'break' | 'closed'; label: string }

interface TxfData {
  ok: boolean;
  spot: number;
  session?: SessionInfo;
  spotSession?: SessionInfo;
  fallback?: boolean;
  fallbackAsOf?: string;
  front: {
    symbol: string; name: string; last: number; ref: number;
    open: number; high: number; low: number; volume: number;
    change: number; changePct: number; basis: number; basisPct: number;
    bid: number; ask: number; bidSize: number; askSize: number;
    date: string; time: string;
  };
  contracts: Array<{
    symbol: string; name: string; last: number; changePct: number; volume: number;
  }>;
}

const up = '#ef4444', down = '#22c55e'; // 台股慣例：紅漲綠跌

export default function TxfHeader() {
  const [data, setData] = useState<TxfData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/txf').then(r => r.json()).then(d => { if (alive) setData(d); }).catch(() => {});
    load();
    const t = setInterval(load, 5000); // 即時刷新：觀看中每5秒同步
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data || !data.ok) {
    return (
      <div className="panel" style={{ padding: 20, color: '#8b949e' }}>
        台指期報價載入中...（TAIFEX MIS）
      </div>
    );
  }

  const f = data.front;
  const sess = data.session;
  const closed = sess && sess.state !== 'open';
  const hasData = !!(f && (f.last > 0 || f.ref > 0));
  const color = f.change > 0 ? up : f.change < 0 ? down : '#e6edf3';
  const t = f.time ? `${f.time.slice(0, 2)}:${f.time.slice(2, 4)}:${f.time.slice(4, 6)}` : '--';
  const asOf = data.fallbackAsOf
    ? new Date(data.fallbackAsOf).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
    : '';

  if (!hasData) {
    return (
      <div className="panel" style={{ padding: 20, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: '#d29922', fontWeight: 700 }}>🔒 {sess?.label || '非交易時段'}</span>
        <span>台指期報價來源暫無回應（TAIFEX MIS），無最後收盤快照可顯示 — 每 5 秒自動重試，恢復後自動載入。</span>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 主報價列 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, alignItems: 'stretch' }}>
        <div style={{ flex: '0 0 auto', padding: '16px 22px', borderRight: '1px solid #21262d' }}>
          <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
            台指期近月 · {f.name || f.symbol} · TAIFEX {f.date} {t}
            {closed && (
              <span style={{ marginLeft: 8, color: '#d29922', fontWeight: 700 }}>🔒 {sess!.label}</span>
            )}
            {sess && sess.state === 'open' && !data.fallback && (
              <span style={{ marginLeft: 8, color: '#3fb950', fontWeight: 700 }}>🟢 {sess.label}</span>
            )}
            {data.fallback && (
              <span style={{ marginLeft: 8, color: '#3fb950', fontWeight: 700 }} title="報價來源暫未回應，顯示最後有效收盤快照">📌 最後收盤資料{asOf ? ` · ${asOf}` : ''}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 40, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>
              {f.last ? f.last.toLocaleString() : '--'}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
              {f.change > 0 ? '+' : ''}{f.change.toLocaleString()}（{f.changePct > 0 ? '+' : ''}{f.changePct.toFixed(2)}%）
            </span>
          </div>
          <div style={{ color: '#8b949e', fontSize: 13, marginTop: 6 }}>
            {f.open ? `開 ${f.open.toLocaleString()}` : '開 --'} · {f.high ? `高 ${f.high.toLocaleString()}` : '高 --'} · {f.low ? `低 ${f.low.toLocaleString()}` : '低 --'} · {f.volume ? `量 ${f.volume.toLocaleString()} 口` : '量 --'}
          </div>
        </div>

        {/* 基差 / 買賣檔 / 現貨 */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', minHeight: 90 }}>
          <MiniStat label="期現貨基差" value={f.basis ? (f.basis > 0 ? '+' : '') + f.basis.toFixed(1) : '--'}
            sub={f.basisPct ? `${f.basisPct > 0 ? '+' : ''}${f.basisPct.toFixed(2)}%` : ''}
            color={f.basis > 0 ? up : f.basis < 0 ? down : '#e6edf3'}
            hint="正基差=期貨溢價（多頭結構）" />
          <MiniStat label="台指現貨" value={data.spot ? data.spot.toLocaleString() : '--'} sub="加權指數參考" />
          <MiniStat label="委買 / 委賣" value={f.bid || f.ask ? `${f.bid.toLocaleString()} / ${f.ask.toLocaleString()}` : '-- / --'}
            sub={f.bidSize || f.askSize ? `${f.bidSize} 口 / ${f.askSize} 口` : '收盤後無委買賣檔'} />
          <MiniStat label="漲跌幅狀態" value={f.changePct >= 0 ? '偏多' : '偏空'}
            color={f.changePct >= 0 ? up : down}
            sub={Math.abs(f.changePct) > 2 ? '⚠ 波動放大，注意部位' : '正常波動區間'} />
        </div>
      </div>

      {/* 各月合約 */}
      <div style={{ borderTop: '1px solid #21262d', padding: '10px 22px', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: '#8b949e' }}>月合約：</span>
        {data.contracts.slice(0, 5).map(c => (
          <span key={c.symbol} style={{ color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
            {c.name}{' '}
            <b style={{ color: c.changePct > 0 ? up : c.changePct < 0 ? down : '#e6edf3' }}>
              {c.changePct > 0 ? '+' : ''}{c.changePct.toFixed(2)}%
            </b>
            <span style={{ color: '#8b949e' }}> 量{c.volume.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub, color = '#e6edf3', hint }: {
  label: string; value: string; sub?: string; color?: string; hint?: string;
}) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid #21262d' }} title={hint}>
      <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ color: '#8b949e', fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
