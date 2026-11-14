'use client';

import { useEffect, useState, useCallback } from 'react';

// ════════════════════════════════════════════════════════════
// 建議紀錄專欄：每整點/每半點自動記錄當下建議（買/賣/觀望、區間、平倉條件）
// 記錄存「雲端線上庫」（/api/advice-log → JSON bin），任何裝置開啟都查得到
// ════════════════════════════════════════════════════════════
interface SnapRecord {
  slot: string;        // "2026-11-14 22:30"
  ts: string;          // 完整時間
  phaseLabel: string;
  ref: number | null;
  score: number;
  dir: string;         // 多 / 空 / 觀望
  advice: string;
  zone: string;
  exitRule: string;
  drivers: string;
}

export default function AdviceLog() {
  const [records, setRecords] = useState<SnapRecord[]>([]);
  const [current, setCurrent] = useState<SnapRecord | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);

  const fetchSnap = useCallback(async () => {
    try {
      const r = await fetch('/api/snap-advice', { cache: 'no-store' });
      if (!r.ok) return;
      const d = (await r.json()) as SnapRecord;
      setCurrent(d);
      // 上傳雲端存檔（同 slot 覆蓋，伺服器端保留 300 筆）
      const p = await fetch('/api/advice-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      if (p.ok) {
        const res = await p.json();
        if (res.ok && Array.isArray(res.records)) {
          setRecords(res.records);
          setCloudOk(true);
          return;
        }
      }
      setCloudOk(false);
    } catch { /* ignore */ }
  }, []);

  const loadCloud = useCallback(async () => {
    try {
      const r = await fetch('/api/advice-log', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (d.ok && Array.isArray(d.records)) {
        setRecords(d.records);
        setCloudOk(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCloud();
    fetchSnap();
    // 每 60 秒檢查是否進入新的半點 slot；每 5 分鐘同步雲端紀錄（跨裝置查詢）
    const timer = setInterval(fetchSnap, 60_000);
    const sync = setInterval(loadCloud, 300_000);
    return () => { clearInterval(timer); clearInterval(sync); };
  }, [fetchSnap, loadCloud]);

  const dirColor = (dir: string) => dir === '多' ? '#f85149' : dir === '空' ? '#3fb950' : '#d29922';

  const shown = expanded ? records : records.slice(0, 8);

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #21262d', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#e6edf3', fontSize: 15, fontWeight: 800 }}>🕐 每 30 分鐘建議紀錄</span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          整點/半點自動上傳雲端存檔（線上可查，跨裝置同步，最多 300 筆）
          {cloudOk === true && <span style={{ color: '#3fb950' }}> · ☁️ 雲端已連線</span>}
          {cloudOk === false && <span style={{ color: '#d29922' }}> · ⚠️ 雲端暫時無法寫入，稍後自動重試</span>}
        </span>
      </div>

      {/* 當下最新建議 */}
      {current && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #21262d', background: '#10141b' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ background: dirColor(current.dir), color: '#0d1117', fontWeight: 900, fontSize: 15, padding: '4px 14px', borderRadius: 6 }}>
              {current.advice}
            </span>
            <span style={{ color: '#c9d1d9', fontSize: 13 }}>快照分數 {current.score > 0 ? '+' : ''}{current.score} · {current.phaseLabel} · 現價 {current.ref ? Math.round(current.ref).toLocaleString() : '--'} 點</span>
            <span style={{ color: '#6b7280', fontSize: 12 }}>{current.ts}</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8, color: '#c9d1d9' }}>
            <div>📍 <b style={{ color: '#e6edf3' }}>買賣區間：</b>{current.zone}</div>
            <div>🏁 <b style={{ color: '#e6edf3' }}>平倉條件：</b>{current.exitRule}</div>
            {current.drivers && <div style={{ color: '#8b949e', fontSize: 12 }}>依據：{current.drivers}</div>}
          </div>
        </div>
      )}

      {/* 歷史紀錄表（雲端） */}
      <div style={{ padding: '10px 12px', overflowX: 'auto' }}>
        {records.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: 8 }}>載入雲端紀錄中… 每到整點/半點會自動上傳一筆，任何裝置開啟本頁都查得到。</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr style={{ color: '#8b949e', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>時間（台北）</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>時段</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>看多/看空</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>現價</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>分數</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>建議</th>
                <th style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>區間 / 平倉條件</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.slot + i} style={{ color: '#c9d1d9' }}>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>{r.slot.slice(5)}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>{r.phaseLabel}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22' }}>
                    <b style={{ color: dirColor(r.dir) }}>{r.dir === '多' ? '📈 看多' : r.dir === '空' ? '📉 看空' : '⏸ 觀望'}</b>
                  </td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>{r.ref ? Math.round(r.ref).toLocaleString() : '--'}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22' }}>{r.score > 0 ? '+' : ''}{r.score}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>{r.advice}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22' }}>
                    {r.zone}<br />
                    <span style={{ color: '#6b7280', fontSize: 11.5 }}>{r.exitRule}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {records.length > 8 && (
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 8, background: 'none', border: '1px solid #30363d', color: '#58a6ff', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {expanded ? '收起' : `展開全部 ${records.length} 筆`}
          </button>
        )}
      </div>
    </div>
  );
}
