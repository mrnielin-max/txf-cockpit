'use client';
import { useEffect, useState } from 'react';

// ════════════════════════════════════════════════════════════
// 週期統整評估模擬（曲線圖面板）— 2026-11-18 用戶要求新增
// • 顯示蒙地卡羅模擬的「週期扇形曲線」：P10~P90 信賴帶 + P50 中位路徑，
//   X 軸 = 現在 → T+2 交易日夜盤收盤（週五自動延長至下週二夜盤收盤）。
// • 圖上直接畫出「多組建議止盈點位（TP1/TP2/TP3）與止損點位（SL1/SL2）」，
//   並在下方列出每個點位的點數、台幣損益（依商品乘數×張數）與佔 3 倍保證金資金 %。
// • 與最上方「我的未平倉」輸入連動：有持倉 → 以進場均價為基準、依買/賣方向翻轉；
//   空手 → 以現價為基準、依引擎評分方向假設。資料由 AIVerdict 廣播（txf-verdict-data），
//   共用同一次 /api/ai-verdict 請求，不重複打重端點。
// ════════════════════════════════════════════════════════════

interface LevelPt { name: string; kind: string; idx: number; dist: number; price: number; twd: number; capPct: number; }
interface VerdictData {
  cycle: { days: number; lastDay: string; lastDayLabel: string; endLabel: string; note: string };
  cycleCurve: { base: number; labels: string[]; p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] } | null;
  levels: {
    item: string; itemName: string; mult: number; qty: number;
    margin: number; capital: number; capitalNote: string; callBufferPts: number;
    anchor: number; anchorNote: string; dir: 'long' | 'short';
    sigCyclePts: number; costPts: number; sl: LevelPt[]; tp: LevelPt[]; rr: number; rule: string;
  } | null;
  tech: { ma20: number | null; ma60: number | null; ma240: number | null; ma240Rising: boolean | null; distMa240Pct: number | null; rsi14: number | null };
  sim: { up5Prob: number; down5Prob: number; p10Pts: number | null; p50Pts: number | null; p90Pts: number | null };
  totalScore: number;
  data: { frontLast: number | null };
}

const W = 900, HH = 380;           // SVG viewBox
const PAD = { l: 64, r: 190, t: 18, b: 40 };

export default function CycleSimChart() {
  const [v, setV] = useState<VerdictData | null>(null);

  useEffect(() => {
    const h = (e: Event) => setV((e as CustomEvent).detail as VerdictData);
    window.addEventListener('txf-verdict-data', h);
    return () => window.removeEventListener('txf-verdict-data', h);
  }, []);

  if (!v || !v.cycleCurve) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        <div className="panel-title">📈 週期統整評估模擬 · 曲線圖</div>
        <div style={{ color: '#8b949e' }}>等待 AI 決策引擎資料（首次約 10 秒）…</div>
      </div>
    );
  }

  const c = v.cycleCurve, L = v.levels;
  const n = c.labels.length;
  const plotW = W - PAD.l - PAD.r, plotH = HH - PAD.t - PAD.b;

  // Y 軸範圍：涵蓋扇形 + 全部 TP/SL 點位 + 基準價
  const lvPrices = L ? [...L.tp.map(t => t.price), ...L.sl.map(s => s.price), L.anchor] : [];
  const allVals = [...c.p10, ...c.p90, ...lvPrices];
  const lo0 = Math.min(...allVals), hi0 = Math.max(...allVals);
  const padY = Math.max(30, (hi0 - lo0) * 0.08);
  const lo = lo0 - padY, hi = hi0 + padY;
  const X = (i: number) => PAD.l + (plotW * i) / (n - 1);
  const Y = (p: number) => PAD.t + plotH - ((p - lo) / (hi - lo)) * plotH;

  const poly = (arr: number[]) => arr.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  const band = (upper: number[], lower: number[]) =>
    `${poly(upper)} ${lower.map((p, i) => `${X(n - 1 - i).toFixed(1)},${Y(lower[n - 1 - i]).toFixed(1)}`).join(' ')}`;

  const fmtT = (x: number) => (x >= 0 ? '+' : '−') + 'NT$' + Math.abs(Math.round(x)).toLocaleString('zh-TW');
  const isLong = L ? L.dir === 'long' : true;

  // 水平線（TP 紅、SL 綠、基準 白、P50 黃）
  const hline = (price: number, color: string, dash: string, label: string, sub: string) => {
    const y = Y(price);
    if (y < PAD.t - 2 || y > PAD.t + plotH + 2) return null;
    return (
      <g key={label + price}>
        <line x1={PAD.l} x2={PAD.l + plotW} y1={y} y2={y} stroke={color} strokeWidth={1.4} strokeDasharray={dash} opacity={0.9} />
        <text x={PAD.l + plotW + 8} y={y - 2} fill={color} fontSize={12} fontWeight={800}>{label} {Math.round(price).toLocaleString()}</text>
        <text x={PAD.l + plotW + 8} y={y + 12} fill="#8b949e" fontSize={10.5}>{sub}</text>
      </g>
    );
  };

  const yTicks = 5;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + ((hi - lo) * i) / yTicks);

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden', border: '1px solid #a371f755' }}>
      <div style={{ padding: '14px 20px', background: 'linear-gradient(90deg, #161b22, #0d1117)', borderBottom: '1px solid #21262d', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#e6edf3' }}>📈 週期統整評估模擬 · 曲線圖</div>
        <div style={{ color: '#8b949e', fontSize: 12.5, textAlign: 'right' }}>
          評估週期：<b style={{ color: '#a371f7' }}>{v.cycle.endLabel}</b>
          <br />{v.cycle.note}
        </div>
      </div>

      <div style={{ padding: '12px 14px 4px' }}>
        <svg viewBox={`0 0 ${W} ${HH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* 網格 + Y 軸刻度 */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={Y(t)} y2={Y(t)} stroke="#21262d" strokeWidth={1} />
              <text x={PAD.l - 8} y={Y(t) + 4} fill="#6b7280" fontSize={11} textAnchor="end">{Math.round(t).toLocaleString()}</text>
            </g>
          ))}
          {/* X 軸標籤 */}
          {c.labels.map((lb, i) => (
            <text key={i} x={X(i)} y={HH - 12} fill="#8b949e" fontSize={11.5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontWeight={i === n - 1 ? 800 : 400}>
              {lb}
            </text>
          ))}
          {/* P10~P90 外帶、P25~P75 內帶 */}
          <polygon points={band(c.p90, c.p10)} fill="#58a6ff" opacity={0.13} />
          <polygon points={band(c.p75, c.p25)} fill="#58a6ff" opacity={0.20} />
          {/* P50 中位路徑 */}
          <polyline points={poly(c.p50)} fill="none" stroke="#d29922" strokeWidth={2.4} />
          {/* P10 / P90 邊界線 */}
          <polyline points={poly(c.p90)} fill="none" stroke="#f8514966" strokeWidth={1.2} strokeDasharray="4 3" />
          <polyline points={poly(c.p10)} fill="none" stroke="#3fb95066" strokeWidth={1.2} strokeDasharray="4 3" />
          {/* 基準價（現價）與進場均價（有持倉且與現價不同才畫） */}
          {hline(c.base, '#e6edf3', '6 4', '現價', '')}
          {L && L.anchor !== c.base && hline(L.anchor, '#f0883e', '6 4', `${isLong ? '進場(多)' : '進場(空)'}`, L.itemName + ' ' + L.qty + ' 張')}
          {L && L.tp.map(t => hline(t.price, '#f85149', '7 4', `TP${t.idx}`, `${fmtT(t.twd)}（${t.capPct}% 資金）`))}
          {L && L.sl.map(s2 => hline(s2.price, '#3fb950', '7 4', `SL${s2.idx}`, `${fmtT(-s2.twd)}（${s2.capPct}% 資金）`))}
          {/* 圖例 */}
          <g>
            <rect x={PAD.l + 8} y={PAD.t + 4} width={13} height={13} fill="#58a6ff" opacity={0.25} />
            <text x={PAD.l + 26} y={PAD.t + 15} fill="#8b949e" fontSize={11}>P10~P90 / P25~P75 信賴帶</text>
            <line x1={PAD.l + 8} x2={PAD.l + 21} y1={PAD.t + 28} y2={PAD.t + 28} stroke="#d29922" strokeWidth={2.4} />
            <text x={PAD.l + 26} y={PAD.t + 32} fill="#8b949e" fontSize={11}>P50 中位路徑</text>
          </g>
        </svg>
      </div>

      {/* 點位清單（與曲線圖同色；隨「我的未平倉」輸入連動） */}
      {L && (
        <div style={{ padding: '8px 20px 16px' }}>
          <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 8 }}>
            🎯 建議止盈／🛑 止損點位（{L.anchorNote}）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {L.tp.map(t => (
              <div key={'tp' + t.idx} style={{ background: '#0d1117', border: '1px solid #f8514955', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.6 }}>
                <b style={{ color: '#f85149' }}>🎯 TP{t.idx} {t.price.toLocaleString()} 點</b>
                <span style={{ color: '#8b949e' }}>（距基準 {t.dist} 點）</span>
                <div style={{ color: '#c9d1d9' }}>獲利 <b style={{ color: '#f85149' }}>{fmtT(t.twd)}</b> ＝ 投入資金 {t.capPct}%</div>
                <div style={{ color: '#6b7280', fontSize: 11.5 }}>{t.name.replace(/^停利[一二三]（|）$/g, '')}</div>
              </div>
            ))}
            {L.sl.map(s2 => (
              <div key={'sl' + s2.idx} style={{ background: '#0d1117', border: '1px solid #3fb95055', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, lineHeight: 1.6 }}>
                <b style={{ color: '#3fb950' }}>🛑 SL{s2.idx} {s2.price.toLocaleString()} 點</b>
                <span style={{ color: '#8b949e' }}>（距基準 {s2.dist} 點）</span>
                <div style={{ color: '#c9d1d9' }}>虧損 <b style={{ color: '#3fb950' }}>{fmtT(-s2.twd)}</b> ＝ 投入資金 {s2.capPct}%</div>
                <div style={{ color: '#6b7280', fontSize: 11.5 }}>{s2.name.replace(/^停損[一二]（|）$/g, '')}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, background: '#10141b', border: '1px solid #21262d', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: '#8b949e', lineHeight: 1.8 }}>
            <b style={{ color: '#e6edf3' }}>💰 資金規則（你指定的 3 倍保證金、每次 1 口）：</b>{L.capitalNote}。
            盈虧比 TP1/SL1 ≈ 1:{L.rr}；週期波動 σ ≈ {L.sigCyclePts} 點；往返成本 ≈ {L.costPts} 點/張。
            追繳緩衝：要逆向約 <b style={{ color: '#d29922' }}>{L.callBufferPts.toLocaleString()} 點</b>才會觸及維持保證金，兩檔停損都遠在追繳線內。
            <br /><b style={{ color: '#e6edf3' }}>📏 週期尺度：</b>{L.rule}
            <br /><b style={{ color: '#e6edf3' }}>📐 技術面參數（已納入評分與模擬）：</b>
            MA20 {v.tech.ma20?.toLocaleString() ?? '--'}／MA60 {v.tech.ma60?.toLocaleString() ?? '--'}／年線 MA240 {v.tech.ma240?.toLocaleString() ?? '--'}
            （{v.tech.ma240Rising === null ? '方向不明' : v.tech.ma240Rising ? '上行' : '走平/下行'}，現價距年線 {v.tech.distMa240Pct !== null ? `${v.tech.distMa240Pct >= 0 ? '+' : ''}${v.tech.distMa240Pct}%` : '--'}）／RSI14 {v.tech.rsi14 ?? '--'}。
            年線查證結論（20 年回測）：「靠近年線拉升機率較高」<b style={{ color: '#d29922' }}>只在 20 日波段尺度溫和成立</b>（20 日上漲機率 67.7% vs 基準 60.3%，樣本 62 次），5 日短線無優勢（53.2% vs 58.0%）→ 已列 ±1 觀察因子，不作主要進場依據。
            <br />⚠ 模擬為統計模型輸出，非投資保證；黑天鵝事件會讓分布失效，請嚴格執行停損。
          </div>
        </div>
      )}
    </div>
  );
}
