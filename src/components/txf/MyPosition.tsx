'use client';
import { useEffect, useState, useCallback } from 'react';

// ════════════════════════════════════════════════════════════
// 我的未平倉（置頂輸入區）— 教訓（2026-11-17）：
// 網站只給「市場方向」建議，不知道瀏覽者手上是買還是賣、多少張，
// 建議無法對應使用者實際部位。此元件在最上方要求輸入
// 方向（買/賣）＋張數＋均價，存 localStorage 並廣播 txf-pos-change，
// AI 決策引擎收到後輸出【我的持倉】【持倉操作建議】。
// ════════════════════════════════════════════════════════════

export const POS_KEY = 'txf-my-position';
export type PosDir = 'none' | 'long' | 'short';
export interface MyPos { item: 'TXF' | 'MXF' | 'TMF'; dir: PosDir; qty: number; entry: number | null }

const MULT: Record<string, number> = { TXF: 200, MXF: 50, TMF: 10 };
const ITEM_LABEL: Record<string, string> = {
  TXF: '台指期 TXF 大台（每點 200 元）',
  MXF: '小台指 MXF 小台（每點 50 元）',
  TMF: '微台指 TMF 微台（每點 10 元）',
};

export default function MyPosition() {
  const [item, setItem] = useState<'TXF' | 'MXF' | 'TMF'>('TXF');
  const [dir, setDir] = useState<PosDir>('none');
  const [qty, setQty] = useState('');
  const [entry, setEntry] = useState('');
  const [saved, setSaved] = useState<MyPos | null>(null);
  // 三商品即時價區塊（TXF=大台 front、MXF=小台 frontMini、TMF=微台 frontMicro）。
  // 教訓（2026-11-20）：微小大台收盤價各不相同，顯示與損益必須用所選/所存商品自己的價。
  const [blocks, setBlocks] = useState<Record<string, any>>({ TXF: null, MXF: null, TMF: null });
  const [savedAt, setSavedAt] = useState('');

  // 讀取已存部位（含舊版壞 key 遷移：早期版本曾把資料存在錯誤 key 下）
  useEffect(() => {
    try {
      const LEGACY_KEY = '*'.repeat(3); // 舊版誤存的 key
      if (!localStorage.getItem(POS_KEY) && localStorage.getItem(LEGACY_KEY)) {
        localStorage.setItem(POS_KEY, localStorage.getItem(LEGACY_KEY) || '');
        localStorage.removeItem(LEGACY_KEY);
        window.dispatchEvent(new CustomEvent('txf-pos-change'));
      }
      const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null') as (MyPos & { savedAt?: string }) | null;
      if (p && p.dir) {
        setItem(p.item || 'TXF'); setDir(p.dir);
        setQty(p.qty ? String(p.qty) : ''); setEntry(p.entry ? String(p.entry) : '');
        setSaved(p); setSavedAt(p.savedAt || '');
      }
    } catch { /* ignore */ }
  }, []);

  // 即時價格（/api/txf 輕量端點，10 秒同步）：大/小/微台各存自己的近月區塊
  useEffect(() => {
    let alive = true;
    const pull = () => fetch('/api/txf', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (!alive || !d?.ok) return;
      setBlocks({
        TXF: d.front?.last > 0 ? d.front : null,
        MXF: d.frontMini?.last > 0 ? d.frontMini : null,
        TMF: d.frontMicro?.last > 0 ? d.frontMicro : null,
      });
    }).catch(() => {});
    pull(); const t = setInterval(pull, 10 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 顯示價 = 下拉選到的商品自己；損益價 = 已存部位商品自己（該商品 feed 缺席才退回大台價並標示）
  const shown = blocks[item] ?? null;
  const last = shown?.last ?? null;
  const chgPct = shown?.changePct ?? null;
  const posItemKey = saved?.item ?? item;
  const posBlk = blocks[posItemKey] ?? null;
  const posLast: number | null = posBlk?.last ?? blocks.TXF?.last ?? null;
  const posLastIsProxy = !posBlk && posItemKey !== 'TXF' && !!blocks.TXF?.last;

  const save = useCallback(() => {
    const q = Math.max(0, Math.min(9999, parseInt(qty || '0', 10) || 0));
    const e = parseFloat(entry || '') || null;
    let pos: MyPos | null = null;
    if (dir !== 'none' && q > 0 && e && e > 1000 && e < 200000) pos = { item, dir, qty: q, entry: e };
    else if (dir !== 'none') { alert('請輸入正確張數（1–9999）與進場均價（1000–200000 點）'); return; }
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify({ ...pos, savedAt: new Date().toISOString() }));
    else localStorage.removeItem(POS_KEY);
    setSaved(pos); setSavedAt(pos ? new Date().toISOString() : '');
    window.dispatchEvent(new CustomEvent('txf-pos-change'));
  }, [item, dir, qty, entry]);

  const clear = () => {
    localStorage.removeItem(POS_KEY);
    setDir('none'); setQty(''); setEntry(''); setSaved(null); setSavedAt('');
    window.dispatchEvent(new CustomEvent('txf-pos-change'));
  };

  // 未實現損益（以「已存部位」的商品與該商品自己的現價計算）
  const mult = MULT[posItemKey] ?? 200;
  let pnl: { pts: number; twd: number } | null = null;
  if (saved && saved.dir !== 'none' && saved.entry && posLast) {
    const sign = saved.dir === 'long' ? 1 : -1;
    const pts = (posLast - saved.entry) * sign;
    pnl = { pts, twd: pts * saved.qty * mult };
  }
  const risk100 = saved && saved.dir !== 'none' ? 100 * saved.qty * mult : null;

  const btn = (active: boolean, color: string): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
    border: `1px solid ${active ? color : '#30363d'}`,
    background: active ? color + '22' : '#0d1117', color: active ? color : '#8b949e',
  });
  const inp: React.CSSProperties = {
    width: 92, padding: '6px 8px', borderRadius: 8, border: '1px solid #30363d',
    background: '#0d1117', color: '#e6edf3', fontSize: 13.5, outline: 'none',
  };

  return (
    <div className="panel" style={{ padding: '14px 20px', border: '1px solid #f0883e55' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: '#f0883e' }}>🧍 我的未平倉</span>
        <span style={{ color: '#8b949e', fontSize: 12.5 }}>
          先告訴引擎你現在是買還是賣、幾張、均價多少 —— 下方所有數據與建議會以你的持倉為基準
        </span>
        {last && (
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#e6edf3' }}>
            {item} 現價 <b>{last.toLocaleString()}</b>
            {chgPct !== null && <span style={{ color: chgPct >= 0 ? '#f85149' : '#3fb950', marginLeft: 6 }}>{chgPct >= 0 ? '+' : ''}{chgPct}%</span>}
            {shown?.name && <span style={{ color: '#6b7280', fontSize: 11.5, marginLeft: 6 }}>({shown.name})</span>}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <select value={item} onChange={e => setItem(e.target.value as 'TXF' | 'MXF' | 'TMF')} style={{ ...inp, width: 'auto' }}>
          <option value="TXF">{ITEM_LABEL.TXF}</option>
          <option value="MXF">{ITEM_LABEL.MXF}</option>
          <option value="TMF">{ITEM_LABEL.TMF}</option>
        </select>
        <button style={btn(dir === 'long', '#f85149')} onClick={() => setDir('long')}>買（做多）</button>
        <button style={btn(dir === 'short', '#3fb950')} onClick={() => setDir('short')}>賣（做空）</button>
        <button style={btn(dir === 'none', '#8b949e')} onClick={() => setDir('none')}>無持倉</button>
        {dir !== 'none' && (
          <>
            <input style={inp} type="number" min={1} placeholder="張數" value={qty} onChange={e => setQty(e.target.value)} />
            <span style={{ color: '#8b949e', fontSize: 13 }}>張 · 均價</span>
            <input style={inp} type="number" min={1000} placeholder="進場點位" value={entry} onChange={e => setEntry(e.target.value)} />
            <span style={{ color: '#8b949e', fontSize: 13 }}>點</span>
          </>
        )}
        <button onClick={save} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: '#f0883e', color: '#0d1117', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>儲存</button>
        {(saved || dir === 'none') && <button onClick={clear} style={{ ...btn(false, '#8b949e'), fontSize: 12.5 }}>清除</button>}
      </div>

      {/* 已儲存部位的即時損益 */}
      {saved && saved.dir !== 'none' && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: '#161b22', borderRadius: 10, fontSize: 13.5, lineHeight: 1.8 }}>
          <div>
            <b style={{ color: saved.dir === 'long' ? '#f85149' : '#3fb950' }}>
              {saved.dir === 'long' ? '買（做多）' : '賣（做空）'}
            </b>
            {saved.item} {saved.qty} 張 · 均價 {saved.entry!.toLocaleString()} 點
            {savedAt && <span style={{ color: '#6b7280', fontSize: 12 }}>（{new Date(savedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 儲存）</span>}
          </div>
          {pnl && (
            <div>
              未實現損益：<b style={{ color: pnl.pts >= 0 ? '#f85149' : '#3fb950', fontSize: 15 }}>
                {pnl.pts >= 0 ? '+' : ''}{pnl.pts.toFixed(0)} 點 = {pnl.twd >= 0 ? '+' : ''}{Math.round(pnl.twd).toLocaleString()} TWD
              </b>
              <span style={{ color: '#6b7280', fontSize: 12 }}>
                （以 {posBlk?.name || '大台指期貨近月'} 價 {posLast?.toLocaleString()} 計算{posLastIsProxy ? '；小/微台即時價暫無法取得，先以大台價代替' : ''}；未計成本：手續費約每張每邊 NT$200、交易稅約成交金額十萬分之一）
              </span>
            </div>
          )}
          {risk100 !== null && (
            <div style={{ color: '#8b949e', fontSize: 12.5 }}>
              ⚠️ 風險敏感度：行情每逆向 100 點，你的損益 = {risk100 >= 0 ? '-' : '+'}{Math.abs(risk100).toLocaleString()} TWD。
              AI 決策引擎的【我的持倉】【持倉操作建議】已同步在下方建議欄生成。
            </div>
          )}
        </div>
      )}
      {saved && saved.dir !== 'none' && !pnl && posLast === null && (
        <div style={{ marginTop: 8, color: '#8b949e', fontSize: 12.5 }}>現價載入中…</div>
      )}
    </div>
  );
}
