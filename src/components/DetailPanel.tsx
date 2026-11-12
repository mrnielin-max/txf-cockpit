'use client';

import { CandleData, StockQuote } from '@/types/stock';
import {
  calcMA, calcRSI, calcMACD, calcBollinger,
  calcKD, calcATR, calcPerformance,
  calcSupportResistance, calcStats,
} from '@/lib/indicators';

interface Props {
  candles: CandleData[];
  quote: StockQuote;
}

const up   = '#3fb950';
const down = '#f85149';
const warn = '#e3b341';
const neu  = '#e6edf3';
const mute = '#8b949e';
const blue = '#58a6ff';
const orange = '#f97316';

function pctText(v: number | null) {
  if (v === null) return '-';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}
function fmt(v: number | null, dec = 2) {
  return v === null ? '-' : v.toFixed(dec);
}

// ── 區塊容器 ──────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: 12, padding: '18px 18px 12px', marginBottom: 14,
    }}>
      <div style={{
        color: mute, fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
        textTransform: 'uppercase', marginBottom: 14,
        borderLeft: `3px solid ${orange}`, paddingLeft: 10,
      }}>{title}</div>
      {children}
    </div>
  );
}

// ── 單一指標列 ──────────────────────────────────────────────
interface MetricRowProps {
  label: string;
  value: string;
  valueColor?: string;
  statusText?: string;
  statusColor?: string;
  reference: string;    // 參考標準值
  opinion: string;      // AI意見
  opinionColor?: string;
}

function MetricRow({
  label, value, valueColor = neu,
  statusText, statusColor = mute,
  reference, opinion, opinionColor,
}: MetricRowProps) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #21262d',
      borderRadius: 8, padding: '12px 14px', marginBottom: 10,
    }}>
      {/* 第一行：指標名稱 + 數值 + 狀態 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ color: mute, fontSize: 13, minWidth: 110 }}>{label}</span>
        <span style={{ color: valueColor, fontWeight: 800, fontSize: 18 }}>{value}</span>
        {statusText && (
          <span style={{
            background: `${statusColor}20`, color: statusColor,
            fontSize: 12, padding: '2px 10px', borderRadius: 6, fontWeight: 600,
          }}>{statusText}</span>
        )}
      </div>

      {/* 第二行：參考標準值 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
        <span style={{
          background: '#21262d', color: blue,
          fontSize: 11, padding: '2px 8px', borderRadius: 4,
          fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        }}>📐 參考基準</span>
        <span style={{ color: mute, fontSize: 13, lineHeight: 1.5 }}>{reference}</span>
      </div>

      {/* 第三行：AI意見 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <span style={{
          background: '#f9731615', color: orange,
          fontSize: 11, padding: '2px 8px', borderRadius: 4,
          fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        }}>🤖 AI意見</span>
        <span style={{ color: opinionColor || '#c9d1d9', fontSize: 13, lineHeight: 1.55 }}>{opinion}</span>
      </div>
    </div>
  );
}

export default function DetailPanel({ candles, quote }: Props) {
  if (candles.length < 30) return null;

  const closes  = candles.map(c => c.close);
  const last    = closes.length - 1;
  const price   = quote.price;

  // ── 計算指標 ──
  const ma5   = calcMA(closes, 5)[last];
  const ma10  = calcMA(closes, 10)[last];
  const ma20  = calcMA(closes, 20)[last];
  const ma60  = calcMA(closes, 60)[last];
  const ma120 = calcMA(closes, 120)[last];
  const rsi14 = calcRSI(closes, 14)[last];
  const rsi6  = calcRSI(closes, 6)[last];
  const { macd, signal, hist } = calcMACD(closes);
  const macdVal  = macd[last];
  const sigVal   = signal[last];
  const histVal  = hist[last];
  const boll  = calcBollinger(closes, 20)[last];
  const kd    = calcKD(candles, 9)[last];
  const atr   = calcATR(candles, 14);
  const perf  = calcPerformance(candles, price);
  const sr    = calcSupportResistance(candles);
  const stats = calcStats(candles, price);
  const limitUp   = quote.market !== 'US' ? parseFloat((quote.prev * 1.10).toFixed(2)) : null;
  const limitDown = quote.market !== 'US' ? parseFloat((quote.prev * 0.90).toFixed(2)) : null;
  const todayVol   = candles[last].volume;
  const volRatio5  = stats.avgVol5  > 0 ? todayVol / stats.avgVol5 * 100  : null;
  const volRatio20 = stats.avgVol20 > 0 ? todayVol / stats.avgVol20 * 100 : null;
  const bollPos    = boll.upper && boll.lower
    ? (price - boll.lower) / (boll.upper - boll.lower) * 100 : null;

  // ── 均線站位計數 ──
  const maArr = [ma5, ma10, ma20, ma60, ma120].filter(Boolean) as number[];
  const aboveCount = maArr.filter(m => price > m).length;

  // ── RSI判讀 ──
  const rsiStatus = !rsi14 ? '資料不足'
    : rsi14 > 80 ? '極度超買' : rsi14 > 70 ? '超買'
    : rsi14 < 20 ? '極度超賣' : rsi14 < 30 ? '超賣' : '中性';
  const rsiColor = !rsi14 ? mute
    : rsi14 > 70 ? down : rsi14 < 30 ? up : neu;

  const rsiOpinion = !rsi14 ? '資料不足'
    : rsi14 > 80 ? `RSI高達${fmt(rsi14)}，市場情緒極度亢奮，短線超買明顯。歷史統計上此區間後3-5日有6成以上機率回落，建議持有者設置移動停利，新進場者應暫緩追高。`
    : rsi14 > 70 ? `RSI ${fmt(rsi14)} 進入超買區（>70），短線追高風險增加。可考慮減少新增部位，已獲利部位可以設定較緊的停利保護利潤。`
    : rsi14 < 20 ? `RSI低至${fmt(rsi14)}，市場處於極度恐慌，短線超賣嚴重。此位置通常是優質資產的長期布局良機，建議分批承接，但需確認底部止穩訊號。`
    : rsi14 < 30 ? `RSI ${fmt(rsi14)} 進入超賣區（<30），賣壓釋放趨近尾聲。若大盤環境不悲觀，此為分批買入的觀察時機，建議等K棒收紅確認後進場。`
    : `RSI ${fmt(rsi14)} 位於健康中性區（30-70），無超買超賣訊號，趨勢可持續。當前動能正常，可依趨勢方向操作。`;

  // ── MACD判讀 ──
  const macdSignal = !histVal ? '資料不足'
    : histVal > 0 && macdVal! > 0 ? '多頭強勢' : histVal > 0 && macdVal! < 0 ? '底部反彈'
    : histVal < 0 && macdVal! < 0 ? '空頭強勢' : '頭部回落';
  const macdColor = !histVal ? mute : histVal > 0 ? up : down;

  const macdOpinion = !histVal ? '資料不足'
    : histVal > 0 && macdVal! > 0 ? `MACD柱狀值正向且MACD線在零軸上方，是最強的多頭訊號。趨勢動能強勁，建議持有並跟趨勢，不要輕易做空。`
    : histVal > 0 && macdVal! < 0 ? `MACD柱狀值翻正但MACD線仍在零軸下方，底部反彈訊號初現。力道尚弱，建議小量試多，觀察是否能站穩零軸上方。`
    : histVal < 0 && macdVal! < 0 ? `MACD柱狀值負向、MACD線在零軸下方，空頭動能強勁。短線不宜做多，有部位者可考慮減碼或等待轉折確認。`
    : `MACD柱狀值翻負，頭部回落訊號，趨勢動能開始衰減。持有獲利部位應提高警戒，考慮縮減部位保護利潤。`;

  // ── KD判讀 ──
  const kdStatus = !kd.k ? '資料不足'
    : kd.k > 80 ? '超買區' : kd.k < 20 ? '超賣區'
    : kd.k! > kd.d! ? 'K > D 黃金交叉' : 'K < D 死亡交叉';
  const kdColor = !kd.k ? mute : kd.k > 80 ? down : kd.k < 20 ? up : kd.k! > kd.d! ? up : down;

  const kdOpinion = !kd.k ? '資料不足'
    : kd.k > 80 ? `KD K值${fmt(kd.k)}進入超買區（>80），短線有鈍化風險。強勢股可能繼續鈍化，但建議設高停利。若K線開始下彎且D線跟隨，是明確的出場訊號。`
    : kd.k < 20 ? `KD K值${fmt(kd.k)}在超賣區（<20），跌深反彈機率高。弱勢股可能繼續鈍化，但若K值開始上彎，是短線反彈進場訊號，停損設近期低點。`
    : kd.k! > kd.d! ? `K值（${fmt(kd.k)}）站上D值（${fmt(kd.d)}），KD黃金交叉確認，短線多方佔優。此訊號結合成交量放大效果更佳，可考慮順勢做多。`
    : `K值（${fmt(kd.k)}）跌破D值（${fmt(kd.d)}），KD死亡交叉，短線空方佔優。建議減少持倉比例，等待KD再度翻多後才考慮重新進場。`;

  // ── 布林帶判讀 ──
  const bollOpinion = bollPos === null ? '資料不足'
    : bollPos > 85 ? `股價已突破布林上軌（位置${bollPos.toFixed(0)}%），短線超漲，回調風險高。通常在80%以上區間3-5日內有均值回歸傾向，建議謹慎追高。`
    : bollPos > 60 ? `股價位於布林帶上半部（${bollPos.toFixed(0)}%），趨勢偏多，有一定的上行空間但接近壓力。持有者可維持部位，新進場者可等回測中軌。`
    : bollPos > 40 ? `股價在布林帶中軌附近（${bollPos.toFixed(0)}%），方向未明，多空均衡。等待突破方向確認，不宜貿然追價。`
    : bollPos > 15 ? `股價在布林帶下半部（${bollPos.toFixed(0)}%），趨勢偏空。若接近下軌且出現止跌K棒，可考慮分批進場，以下軌作為支撐參考。`
    : `股價跌破布林下軌（位置${bollPos.toFixed(0)}%），短線超跌，技術反彈機率高。但布林帶向下擴張時勿輕易搶反彈，等收回下軌上方確認。`;

  // ── ATR判讀 ──
  const atrPct = atr && price ? atr / price * 100 : 0;
  const atrOpinion = atrPct > 3
    ? `ATR達${fmt(atr)}（占股價${atrPct.toFixed(2)}%），波動率偏高，每日價格震幅大。建議縮小部位規模，停損點需設寬，避免因正常日內波動觸發停損。高波動期間不適合重倉操作。`
    : atrPct > 1.5
    ? `ATR ${fmt(atr)}（占股價${atrPct.toFixed(2)}%），波動率正常。停損設定建議以1-2倍ATR為參考，即約${atr ? (atr * 1.5).toFixed(1) : '-'}-${atr ? (atr * 2).toFixed(1) : '-'}元。`
    : `ATR ${fmt(atr)}（占股價${atrPct.toFixed(2)}%），波動率偏低，市場目前較為平靜。低波動往往是大行情前的蓄積期，需留意突破方向。`;

  // ── 均線站位意見 ──
  const maOpinionText = aboveCount >= 4
    ? `股價站上 ${aboveCount}/5 條均線，均線多頭排列趨勢明確。技術面偏多，順勢持有策略優先，回測均線附近可考慮加碼。`
    : aboveCount >= 3
    ? `股價站上 ${aboveCount}/5 條均線，多空勢力均衡。短期均線（MA5/10）方向更具參考性，建議觀察趨勢確認後再操作。`
    : `股價僅站上 ${aboveCount}/5 條均線，均線空頭排列，技術面偏空。各均線形成壓力，反彈至均線附近容易遭遇賣壓，不宜輕易做多。`;

  // ── 支撐壓力意見 ──
  const srOpinion = `近5日壓力 ${fmt(sr.resistance5)}（突破則確認短線走強），近5日支撐 ${fmt(sr.support5)}（跌破則短線出場訊號）。52週區間位置${stats.posIn52}%：${stats.posIn52 > 70 ? '位置偏高，需留意估值壓力' : stats.posIn52 < 30 ? '位置偏低，長期買點具吸引力' : '位置適中，風險報酬相對平衡'}。`;

  // ── 量能意見 ──
  const volOpinion = volRatio5 === null ? '資料不足'
    : volRatio5 > 200 ? `今日成交量是5日均量的 ${volRatio5.toFixed(0)}%（超過2倍），大幅放量。需判斷是主力進場（伴隨上漲）還是恐慌賣出（伴隨下跌），量能突增是關鍵訊號，務必注意後續走勢。`
    : volRatio5 > 130 ? `量比 ${volRatio5.toFixed(0)}%，溫和放量。若伴隨上漲則屬價量齊揚健康格局；若伴隨下跌則需留意籌碼鬆動。`
    : volRatio5 < 60 ? `量比只有 ${volRatio5.toFixed(0)}%，明顯縮量。縮量時行情方向不可信，突破或跌破若無量能配合，有假突破風險。`
    : `量比 ${volRatio5.toFixed(0)}%，成交量正常，無特殊異常。`;

  return (
    <div>
      {/* ── 時間段績效 ── */}
      <Section title="📅 時間段績效">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
          {[
            { label: '1週', val: perf.w1 }, { label: '1月', val: perf.m1 },
            { label: '3月', val: perf.m3 }, { label: '6月', val: perf.m6 },
            { label: '1年', val: perf.y1 },
          ].map(item => (
            <div key={item.label} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
              <div style={{ color: mute, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
              <div style={{ color: item.val === null ? mute : item.val > 0 ? up : item.val < 0 ? down : neu, fontWeight: 800, fontSize: 16 }}>
                {pctText(item.val)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#f9731615', color: orange, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>🤖 AI意見</span>
          <span style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.55 }}>
            {perf.y1 !== null && perf.y1 > 30
              ? `近1年漲幅高達 ${pctText(perf.y1)}，屬強勢標的。歷史統計強勢股有慣性效應，但也需評估是否已過度上漲。建議比較同期大盤與產業指數，若明顯跑贏則短線需留意獲利了結壓力。`
              : perf.y1 !== null && perf.y1 < -20
              ? `近1年下跌 ${pctText(perf.y1)}，基本面或產業面可能有重大問題。建議深入研究基本面後才考慮逢低買入，避免接住下跌中的「飛刀」。`
              : `近期績效數據顯示趨勢溫和，與大盤走勢同步。建議比對同類股績效，判斷是否有相對強弱優勢，選擇產業中的相對強勢個股操作。`}
          </span>
        </div>
      </Section>

      {/* ── 均線系統 ── */}
      <Section title="📈 均線系統">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 10 }}>
          {[
            { label: 'MA5', val: ma5, days: '5日' }, { label: 'MA10', val: ma10, days: '10日' },
            { label: 'MA20', val: ma20, days: '20日（月線）' }, { label: 'MA60', val: ma60, days: '60日（季線）' },
            { label: 'MA120', val: ma120, days: '120日（半年線）' },
          ].map(item => (
            <div key={item.label} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
              <div style={{ color: mute, fontSize: 11, marginBottom: 2 }}>{item.label}</div>
              <div style={{ color: item.val ? (price > item.val ? up : down) : mute, fontWeight: 800, fontSize: 15 }}>
                {fmt(item.val)}
              </div>
              <div style={{ color: mute, fontSize: 11, marginTop: 2 }}>
                {item.val ? (price > item.val ? '▲ 站上' : '▼ 跌破') : '-'}
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#21262d', color: blue, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>📐 參考基準</span>
          <span style={{ color: mute, fontSize: 13, lineHeight: 1.5 }}>站上5條均線＝最強多頭；站上3條＝中性偏多；站上1條以下＝偏空。機構投資人常以MA20（月線）和MA60（季線）作為趨勢判斷基準，這兩條均線的多空位置最具參考價值。</span>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', marginTop: 6, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#f9731615', color: orange, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>🤖 AI意見</span>
          <span style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.55 }}>{maOpinionText}</span>
        </div>
      </Section>

      {/* ── 震盪指標 ── */}
      <Section title="⚡ 震盪指標">
        <MetricRow
          label="RSI (14日)"
          value={fmt(rsi14)}
          valueColor={rsiColor}
          statusText={rsiStatus}
          statusColor={rsiColor}
          reference="超買區：>70（>80為極度超買）；中性區：30-70；超賣區：<30（<20為極度超賣）。機構常以50為多空分界線，RSI>50代表整體動能偏多。"
          opinion={rsiOpinion}
          opinionColor={rsiColor}
        />
        <MetricRow
          label="RSI (6日)"
          value={fmt(rsi6)}
          valueColor={rsi6! > 70 ? down : rsi6! < 30 ? up : neu}
          statusText={rsi6! > 70 ? '短線超買' : rsi6! < 30 ? '短線超賣' : '短線中性'}
          reference="RSI(6)對短線更敏感，反應速度快但雜訊多。適合短線操作者使用，通常與RSI(14)搭配確認，兩者同向時訊號更可靠。"
          opinion={`RSI6短線指標值 ${fmt(rsi6)}，${rsi6! > 70 ? '短線追高需謹慎，可能很快出現回檔整理。' : rsi6! < 30 ? '短線超賣明顯，可留意技術性反彈機會，但需大環境配合。' : '短線動能中性，跟著RSI14方向操作即可。'}`}
        />
        <MetricRow
          label="KD — K值"
          value={`K: ${fmt(kd.k)}  D: ${fmt(kd.d)}`}
          valueColor={kdColor}
          statusText={kdStatus}
          statusColor={kdColor}
          reference="K值>D值為黃金交叉（多方訊號）；K值<D值為死亡交叉（空方訊號）。超買區：K>80；超賣區：K<20。強趨勢時KD可長期鈍化，不宜單獨作為進出場依據。"
          opinion={kdOpinion}
          opinionColor={kdColor}
        />
        <MetricRow
          label="MACD 柱狀值"
          value={fmt(histVal, 4)}
          valueColor={macdColor}
          statusText={macdSignal}
          statusColor={macdColor}
          reference="柱狀值>0且擴大＝多頭加速；柱狀值>0但縮小＝多頭動能衰減；柱狀值<0且擴大＝空頭加速；柱狀值<0但縮小＝空頭力道趨緩。零軸穿越是最強趨勢確認訊號。"
          opinion={macdOpinion}
          opinionColor={macdColor}
        />
        <MetricRow
          label="MACD線 / Signal線"
          value={`${fmt(macdVal, 4)} / ${fmt(sigVal, 4)}`}
          valueColor={macdVal! > 0 ? up : down}
          reference="MACD線穿越Signal線向上＝買入訊號；向下穿越＝賣出訊號。MACD線在零軸以上時多頭較可信，在零軸以下時空頭訊號較可信。"
          opinion={`MACD線 ${fmt(macdVal, 4)}，Signal線 ${fmt(sigVal, 4)}。${macdVal! > sigVal! ? 'MACD線>Signal線，短線多方動能較強，持多順勢。' : 'MACD線<Signal線，短線空方動能較強，謹慎持多。'}`}
        />
        <MetricRow
          label="ATR (14) 波動率"
          value={fmt(atr)}
          reference="ATR占股價1%以下＝低波動；1-3%＝正常波動；3%以上＝高波動。停損設定建議以1.5-2倍ATR為參考，太緊容易被正常波動洗出場。"
          opinion={atrOpinion}
        />
        <MetricRow
          label="布林帶位置"
          value={bollPos !== null ? `${bollPos.toFixed(1)}%` : '-'}
          valueColor={bollPos! > 80 ? down : bollPos! < 20 ? up : neu}
          statusText={bollPos! > 80 ? '接近上軌' : bollPos! < 20 ? '接近下軌' : '帶內運行'}
          statusColor={bollPos! > 80 ? down : bollPos! < 20 ? up : neu}
          reference={`上軌：${fmt(boll.upper)}（壓力）；中軌：${fmt(boll.mid)}（均值）；下軌：${fmt(boll.lower)}（支撐）。0%=下軌，50%=中軌，100%=上軌。80%以上需謹慎追高，20%以下可考慮分批布局。`}
          opinion={bollOpinion}
        />
      </Section>

      {/* ── 支撐壓力 ── */}
      <Section title="🎯 支撐 / 壓力 / 52週區間">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
          {[
            { label: '近5日壓力', val: fmt(sr.resistance5), color: down },
            { label: '近5日支撐', val: fmt(sr.support5), color: up },
            { label: '近20日壓力', val: fmt(sr.resistance20), color: down },
            { label: '近20日支撐', val: fmt(sr.support20), color: up },
          ].map(item => (
            <div key={item.label} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
              <div style={{ color: mute, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
              <div style={{ color: item.color, fontWeight: 800, fontSize: 16 }}>{item.val}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
            <div style={{ color: mute, fontSize: 11, marginBottom: 2 }}>52週最高</div>
            <div style={{ color: down, fontWeight: 800, fontSize: 16 }}>{fmt(stats.high52)}</div>
            <div style={{ color: mute, fontSize: 11 }}>距今 {pctText((price - stats.high52) / stats.high52 * 100)}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
            <div style={{ color: mute, fontSize: 11, marginBottom: 2 }}>52週最低</div>
            <div style={{ color: up, fontWeight: 800, fontSize: 16 }}>{fmt(stats.low52)}</div>
            <div style={{ color: mute, fontSize: 11 }}>距今 {pctText((price - stats.low52) / stats.low52 * 100)}</div>
          </div>
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
            <div style={{ color: mute, fontSize: 11, marginBottom: 2 }}>52週位置</div>
            <div style={{ color: stats.posIn52 > 70 ? down : stats.posIn52 < 30 ? up : neu, fontWeight: 800, fontSize: 16 }}>{stats.posIn52}%</div>
            <div style={{ color: mute, fontSize: 11 }}>0%=年低 100%=年高</div>
          </div>
        </div>
        {limitUp && (
          <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', marginBottom: 10 }}>
            <div style={{ color: mute, fontSize: 11, marginBottom: 4 }}>台股漲跌停板（±10%）</div>
            <span style={{ color: up, fontWeight: 700, fontSize: 15 }}>↑漲停 {limitUp}</span>
            <span style={{ color: mute, fontSize: 14, margin: '0 10px' }}>|</span>
            <span style={{ color: down, fontWeight: 700, fontSize: 15 }}>↓跌停 {limitDown}</span>
          </div>
        )}
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#f9731615', color: orange, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>🤖 AI意見</span>
          <span style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.55 }}>{srOpinion}</span>
        </div>
      </Section>

      {/* ── 成交量分析 ── */}
      <Section title="📊 成交量分析">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
          {[
            {
              label: '今日成交量',
              val: quote.market === 'US'
                ? `${(todayVol / 1_000_000).toFixed(2)}M`
                : `${todayVol.toLocaleString()} 張`,
            },
            {
              label: '5日均量',
              val: quote.market === 'US'
                ? `${(stats.avgVol5 / 1_000_000).toFixed(2)}M`
                : `${stats.avgVol5.toLocaleString()} 張`,
            },
            {
              label: '量比 vs 5日均',
              val: volRatio5 !== null ? `${volRatio5.toFixed(0)}%` : '-',
              color: volRatio5! > 150 ? up : volRatio5! < 70 ? down : neu,
              sub: volRatio5! > 150 ? '放量' : volRatio5! < 70 ? '縮量' : '正常',
            },
            {
              label: '量比 vs 20日均',
              val: volRatio20 !== null ? `${volRatio20.toFixed(0)}%` : '-',
              color: volRatio20! > 150 ? up : volRatio20! < 70 ? down : neu,
            },
          ].map(item => (
            <div key={item.label} style={{ background: '#0d1117', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid #21262d' }}>
              <div style={{ color: mute, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
              <div style={{ color: ('color' in item && item.color) ? item.color : neu, fontWeight: 800, fontSize: 15 }}>{item.val}</div>
              {'sub' in item && item.sub && <div style={{ color: mute, fontSize: 11, marginTop: 2 }}>{item.sub}</div>}
            </div>
          ))}
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', marginBottom: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#21262d', color: blue, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>📐 參考基準</span>
          <span style={{ color: mute, fontSize: 13, lineHeight: 1.5 }}>{'量比 > 150% 為放量（可能有主力進出）；70-150% 為正常；< 70% 為縮量（方向不可信）。「量先於價」：成交量往往領先股價變化，是最重要的確認指標之一。'}</span>
        </div>
        <div style={{ background: '#0d1117', borderRadius: 8, padding: '10px 14px', border: '1px solid #21262d', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ background: '#f9731615', color: orange, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>🤖 AI意見</span>
          <span style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.55 }}>{volOpinion}</span>
        </div>
      </Section>
    </div>
  );
}
