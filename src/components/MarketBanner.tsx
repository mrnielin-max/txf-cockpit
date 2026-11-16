'use client';
import { useEffect, useState } from 'react';

interface IndexData {
  name: string; value: number; prev: number; change: number; changePct: number; volume: number;
}
interface SessionInfo { state: 'open' | 'break' | 'closed'; label: string }

export default function MarketBanner() {
  const [taiex, setTaiex] = useState<IndexData | null>(null);
  const [otc,   setOtc]   = useState<IndexData | null>(null);
  const [fitx,  setFitx]  = useState<IndexData | null>(null);
  const [fite,  setFite]  = useState<IndexData | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionInfo> | null>(null);
  const [time,  setTime] = useState('--:--:--');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/market-index');
        const d   = await res.json();
        if (d.taiex) setTaiex(d.taiex);
        if (d.otc)   setOtc(d.otc);
        if (d.fitx)  setFitx(d.fitx);
        if (d.fite)  setFite(d.fite);
        if (d.sessions) setSessions(d.sessions);
      } catch {}
      setTime(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    };
    load();
    const id = setInterval(load, 5000); // 即時刷新：觀看中每5秒同步
    return () => clearInterval(id);
  }, []);

  const Card = ({ d, label, sess }: { d: IndexData | null; label: string; sess?: SessionInfo | null }) => {
    const up  = d && d.change >= 0;
    const clr = d ? (up ? '#ef4444' : '#22c55e') : '#6b7280';
    const sign = d && up ? '+' : '';
    const closed = sess && sess.state !== 'open';
    // 收盤/午休：凍結顯示最終價格並標注狀態，直到下次開盤
    const footer = closed
      ? `🔒 ${sess!.label}`
      : (d && d.volume > 0 ? `成交量 ${d.volume.toLocaleString()} 張` : '盤中更新');
    return (
      <div style={{ background: '#21262d', borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 180, opacity: closed ? 0.85 : 1 }}>
        <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 4, fontWeight: 500 }}>
          {label}
          {closed && <span style={{ marginLeft: 6, fontSize: 11, color: '#d29922' }}>收盤</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: clr, letterSpacing: -1 }}>
            {d ? d.value.toLocaleString('zh-TW', { minimumFractionDigits: 2 }) : '--'}
          </span>
          <span style={{ fontSize: 14, color: clr, fontWeight: 600 }}>
            {d ? `${sign}${d.change.toFixed(2)} (${sign}${d.changePct.toFixed(2)}%)` : ''}
          </span>
        </div>
        <div style={{ color: closed ? '#d29922' : '#6b7280', fontSize: 12, marginTop: 4 }}>
          {footer}
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: '#161b22', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ borderLeft: '3px solid #f97316', paddingLeft: 10, color: '#e6edf3', fontWeight: 700, fontSize: 16 }}>
          台灣指數
        </div>
        <div style={{ color: '#6b7280', fontSize: 13 }}>更新 {time}</div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Card d={taiex} label="加權指數 TAIEX" sess={sessions?.spot} />
        <Card d={otc}   label="櫃買指數 OTC"   sess={sessions?.spot} />
        <Card d={fitx}  label="台指期貨 FITX"  sess={sessions?.fitx} />
        <Card d={fite}  label="台指電子盤 FITE" sess={sessions?.fite} />
      </div>
    </div>
  );
}
