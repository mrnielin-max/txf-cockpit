'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

// ════════════════════════════════════════════════════════════
// 建議紀錄專欄：每整點/每半點自動記錄當下建議（買/賣/觀望、區間、平倉條件）
// 記錄存「雲端線上庫」（/api/advice-log → JSON bin），任何裝置開啟都查得到
// 支援查詢：日期篩選 + 方向篩選 + 關鍵字搜尋，最多顯示 300 筆
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
  backfilled?: boolean;
}

export default function AdviceLog() {
  const [records, setRecords] = useState<SnapRecord[]>([]);
  const [current, setCurrent] = useState<SnapRecord | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  // ── 查詢狀態 ──
  const [q, setQ] = useState('');                    // 關鍵字
  const [dateFilter, setDateFilter] = useState('');  // 日期 YYYY-MM-DD
  const [dirFilter, setDirFilter] = useState('全部');

  const fetchSnap = useCallback(async () => {
    try {
      const r = await fetch('/api/snap-advice', { cache: 'no-store' });
      if (!r.ok) return;
      const d = (await r.json()) as SnapRecord;
      setCurrent(d);
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

  // 回溯重建近 5 日紀錄（只在第一次載入且紀錄 < 100 筆時自動跑一次）
  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const r = await fetch('/api/advice-backfill', { cache: 'no-store' });
      if (r.ok) {
        await loadCloud();
      }
    } catch { /* ignore */ }
    setBackfilling(false);
  }, [loadCloud]);

  useEffect(() => {
    loadCloud();
    fetchSnap();
    const timer = setInterval(fetchSnap, 60_000);
    const sync = setInterval(loadCloud, 300_000);
    return () => { clearInterval(timer); clearInterval(sync); };
  }, [fetchSnap, loadCloud]);

  // 紀錄少於 100 筆時自動回溯補齊近 5 日
  useEffect(() => {
    if (cloudOk === true && records.length > 0 && records.length < 100) {
      runBackfill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudOk, records.length]);

  const dirColor = (dir: string) => dir === '多' ? '#f85149' : dir === '空' ? '#3fb950' : '#d29922';

  // ── 查詢篩選 ──
  const filtered = useMemo(() => {
    let out = records;
    if (dateFilter) out = out.filter(r => r.slot.startsWith(dateFilter));
    if (dirFilter !== '全部') out = out.filter(r => r.dir === dirFilter);
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      out = out.filter(r =>
        (r.slot + r.phaseLabel + r.advice + r.zone + r.exitRule + (r.drivers || '')).toLowerCase().includes(kw)
      );
    }
    return out;
  }, [records, dateFilter, dirFilter, q]);

  const dates = useMemo(() => [...new Set(records.map(r => r.slot.slice(0, 10)))].sort().reverse(), [records]);
  const isFiltered = !!(q.trim() || dateFilter || dirFilter !== '全部');
  const shown = expanded ? filtered : filtered.slice(0, 8);

  const inputStyle: React.CSSProperties = {
    background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9',
    borderRadius: 6, padding: '5px 10px', fontSize: 12.5, outline: 'none',
  };

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #21262d', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#e6edf3', fontSize: 15, fontWeight: 800 }}>🕐 每 30 分鐘建議紀錄</span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>整點/半點自動上傳雲端存檔（線上可查，跨裝置同步，最多 300 筆）</span>
        <span style={{ color: cloudOk === null ? '#6b7280' : cloudOk ? '#3fb950' : '#f85149', fontSize: 12 }}>
          {cloudOk === null ? '⏳ 連線中…' : cloudOk ? '☁️ 雲端已連線' : '⚠ 雲端未連線（本機快取）'}
        </span>
        {backfilling && <span style={{ color: '#a371f7', fontSize: 12 }}>⏳ 正在回溯重建近 5 日紀錄…</span>}
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

      {/* 查詢列 */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #21262d', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: 12.5 }}>🔍 查詢</span>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="關鍵字（如 建議賣、夜盤、NVDA…）"
          style={{ ...inputStyle, flex: '1 1 200px', minWidth: 160 }}
        />
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={inputStyle}>
          <option value="">全部日期</option>
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={dirFilter} onChange={e => setDirFilter(e.target.value)} style={inputStyle}>
          <option value="全部">全部方向</option>
          <option value="多">📈 看多</option>
          <option value="空">📉 看空</option>
          <option value="觀望">⏸ 觀望</option>
        </select>
        {(isFiltered || expanded) && (
          <button onClick={() => { setQ(''); setDateFilter(''); setDirFilter('全部'); setExpanded(false); }}
            style={{ background: 'none', border: '1px solid #30363d', color: '#8b949e', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            清除
          </button>
        )}
        <span style={{ color: '#6b7280', fontSize: 12 }}>共 {filtered.length} 筆{isFiltered ? `（篩選自 ${records.length} 筆）` : ''}</span>
      </div>

      {/* 歷史紀錄表 */}
      <div style={{ padding: '10px 12px', overflowX: 'auto' }}>
        {records.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: 8 }}>尚無歷史紀錄 — 正在從雲端載入並回溯重建近 5 日紀錄…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: 8 }}>查無符合條件的紀錄。</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
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
                <tr key={r.slot + i} style={{ color: '#c9d1d9', background: r.backfilled ? 'rgba(163,113,247,0.06)' : 'transparent' }}>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #161b22', whiteSpace: 'nowrap' }}>
                    {r.slot.slice(5)}{r.backfilled && <span style={{ color: '#a371f7', fontSize: 10.5 }}> 回溯</span>}
                  </td>
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
        {filtered.length > 8 && (
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 8, background: 'none', border: '1px solid #30363d', color: '#58a6ff', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {expanded ? '收起' : `展開全部 ${filtered.length} 筆`}
          </button>
        )}
      </div>
    </div>
  );
}
