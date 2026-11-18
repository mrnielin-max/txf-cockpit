import { NextRequest, NextResponse } from 'next/server';
import { fetchMisQuoteList, pickFrontContract } from '@/lib/taifexMis';
import { txfSession } from '@/lib/sessionState';

interface Point { t: string; v: number }

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function taipeiHM(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
}
function taipeiDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // YYYY-MM-DD
}

// TWSE 官方分時指數（加權指數，每秒一筆，約 3241 筆；回傳最近一個交易日）
async function fetchTAIEXIntraday(): Promise<{ points: Point[]; dayLabel: string }> {
  const url = 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://www.twse.com.tw' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return { points: [], dayLabel: '' };
    const data = await res.json();
    if (data.stat !== 'OK' || !data.data) return { points: [], dayLabel: '' };

    // 每 60 筆（60 秒）採樣一次 → 約每 1 分鐘一個點
    const rows: string[][] = data.data;
    const sampled = rows.filter((_, i) => i % 60 === 0);
    const points = sampled.map(row => ({
      t: row[0]?.slice(0, 5) || '',  // "09:05:00" → "09:05"
      v: parseFloat(row[1].replace(/,/g, '')),
    })).filter(p => !isNaN(p.v));
    const dayLabel = data.date ? String(data.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : '';
    return { points, dayLabel };
  } catch {
    return { points: [], dayLabel: '' };
  }
}

// Yahoo 分時（range=2d，只取「最近一個交易日」→ 盤後/假日也能顯示最後走勢）
async function fetchYahooLastSession(symbol: string): Promise<{ points: Point[]; dayLabel: string }> {
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=2d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=2d`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const timestamps: number[] = result.timestamp || [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      if (!timestamps.length) continue;

      // 以台北時區分日，取最近一個交易日
      const byDay = new Map<string, Point[]>();
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        const day = taipeiDate(d);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push({ t: taipeiHM(d), v: parseFloat(closes[i]!.toFixed(2)) });
      }
      const days = [...byDay.keys()].sort();
      const lastDay = days[days.length - 1];
      const points = lastDay ? byDay.get(lastDay) || [] : [];
      return { points, dayLabel: lastDay || '' };
    } catch {
      continue;
    }
  }
  return { points: [], dayLabel: '' };
}

// mis.twse 指數快照（t00=加權、o00=櫃買）：午休/盤後回傳最後成交值
async function fetchTwseIndexSnapshot(ch: string): Promise<{ value: number; prev: number; time: string } | null> {
  try {
    const res = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ch}|`, {
      headers: { 'User-Agent': UA },
      next: { revalidate: 15 },
    });
    const data = await res.json();
    const m = data?.msgArray?.[0] ?? {};
    const value = parseFloat(m.z ?? m.o ?? '0') || 0;
    const prev  = parseFloat(m.y ?? '0') || 0;
    const time  = m.tlong ? taipeiHM(new Date(parseInt(m.tlong))) : (m.t || '');
    if (value <= 0) return null;
    return { value, prev, time };
  } catch {
    return null;
  }
}

// 台指期近月快照（TAIFEX MIS）
async function fetchTxfSnapshot(): Promise<{ value: number; prev: number; time: string } | null> {
  try {
    const { quotes } = await fetchMisQuoteList('TXF');
    const front = pickFrontContract(quotes);
    if (!front) return null;
    const value = parseFloat(front.CLastPrice || '0') || parseFloat(front.CRefPrice || '0') || 0;
    const prev  = parseFloat(front.CRefPrice || '0') || 0;
    const ctime = front.CTime || '';
    const time  = ctime.length >= 4 ? `${ctime.slice(0, 2)}:${ctime.slice(2, 4)}` : '';
    if (value <= 0) return null;
    return { value, prev, time };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get('tab') || 'taiex';

  let points: Point[] = [];
  let dayLabel = '';

  if (tab === 'taiex') {
    // 加權指數：TWSE 官方優先（回傳最近交易日完整分時），Yahoo ^TWII 備援
    const twse = await fetchTAIEXIntraday();
    points = twse.points; dayLabel = twse.dayLabel;
    if (points.length === 0) {
      const yh = await fetchYahooLastSession('^TWII');
      points = yh.points; dayLabel = yh.dayLabel;
    }
  } else if (tab === 'otc' || tab === 'fitx') {
    // 櫃買指數/台指期電子盤：官方無公開分時源（Yahoo ^TWOII、FITX00.TWO 已失效）
    // → 直接走「最後收盤狀況」面板，不再顯示空白
    points = [];
  }

  // 無分時資料時 → 回傳最後收盤資訊供前端顯示（用戶要求：非交易時段也要顯示最後狀況）
  let lastClose: { value: number; change: number; pct: number; time: string; label: string } | null = null;
  if (points.length === 0) {
    let snap: { value: number; prev: number; time: string } | null = null;
    let label = '';
    if (tab === 'taiex') { snap = await fetchTwseIndexSnapshot('tse_t00.tw'); label = '加權指數 最後收盤'; }
    else if (tab === 'otc') { snap = await fetchTwseIndexSnapshot('otc_o00.tw'); label = '櫃買指數 最後收盤'; }
    else if (tab === 'fitx') { snap = await fetchTxfSnapshot(); label = `台指期近月 最後收盤（${txfSession().label}）`; }
    if (snap) {
      const change = snap.prev > 0 ? snap.value - snap.prev : 0;
      const pct = snap.prev > 0 ? (change / snap.prev) * 100 : 0;
      lastClose = {
        value: snap.value,
        change: parseFloat(change.toFixed(2)),
        pct: parseFloat(pct.toFixed(2)),
        time: snap.time,
        label,
      };
    }
  }

  return NextResponse.json({ points, dayLabel, lastClose });
}
