'use client';
import { useEffect, useState } from 'react';

interface IndexData {
  name: string; value: number; prev: number; change: number; changePct: number; volume: number;
}

export default function MarketBanner() {
  const [taiex, setTaiex] = useState<IndexData | null>(null);
  const [otc,   setOtc]   = useState<IndexData | null>(null);
  const [fitx,  setFitx]  = useState<IndexData | null>(null);
  const [fite,  setFite]  = useState<IndexData | null>(null);
  const [time,  setTime]  = useState('--:--:--');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/market-index');
        const d   = await res.json();
        if (d.taiex) setTaiex(d.taiex);
        if (d.otc)   setOtc(d.otc);
        if (d.fitx)  setFitx(d.fitx);
        if (d.fite)  setFite(d.fite);
      } catch {}
      setTime(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const Card = ({ d, label }: { d: IndexData | null; label: string }) => {
    const up  = d && d.change >= 0;
    const clr = d ? (up ? '#ef4444' : '#22c55e') : '#6b7280';
    const sign = d && up ? '+' : '';
    return (
      <div style={{ background: '#21262d', borderRadius: 10, padding: '14px 20px', flex: 1, minWidth: 180 }}>
        <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 4, fontWeight: 500 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: clr, letterSpacing: -1 }}>
            {d ? d.value.toLocaleString('zh-TW', { minimumFractionDigits: 2 }) : '--'}
          </span>
          <span style={{ fontSize: 14, color: clr, fontWeight: 600 }}>
            {d ? `${sign}${d.change.toFixed(2)} (${sign}${d.changePct.toFixed(2)}%)` : ''}
          </span>
        </div>
        <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
          {d && d.volume > 0 ? `成交量 ${d.volume.toLocaleString()} 張` : '盤中更新'}
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
        <Card d={taiex} label="加權指數 TAIEX" />
        <Card d={otc}   label="櫃買指數 OTC" />
        <Card d={fitx}  label="台指期貨 FITX" />
        <Card d={fite}  label="台指電子盤 FITE" />
      </div>
    </div>
  );
}
