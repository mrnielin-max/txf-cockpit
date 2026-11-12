import { NextResponse } from 'next/server';

interface StockItem {
  code: string; name: string;
  price: number; change: number; changePct: number;
  volume: number; turnover: number;
  open: number; high: number; low: number;
}

// 全市場盤後資料（含漲停掃描）
async function fetchAllStocksAfterHours(): Promise<StockItem[]> {
  const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 60 },
  });
  const d: Record<string, string>[] = await res.json();
  return d.flatMap(item => {
    const close = parseFloat(item.ClosingPrice || '0');
    const chg   = parseFloat(item.Change || '0');
    const open  = parseFloat(item.OpeningPrice || '0');
    const high  = parseFloat(item.HighestPrice || '0');
    const low   = parseFloat(item.LowestPrice  || '0');
    const vol   = parseFloat(item.TradeVolume  || '0');
    const prev  = close - chg;
    if (close <= 0 || !item.Name || !item.Code) return [];
    const changePct = prev > 0 ? (chg / prev) * 100 : 0;
    return [{
      code: item.Code, name: item.Name,
      price: close, change: parseFloat(chg.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      volume: vol, turnover: parseFloat((vol * close).toFixed(0)),
      open, high, low,
    }];
  });
}

// 盤中固定清單（大型/熱門股）
const STOCKS: string[] = [
  '2330','2454','2303','2344','2408','2379','3034','3711','2382','2357',
  '2353','3231','4938','2345','3008','2376','2301','2356','3037','6770',
  '2881','2882','2886','2884','2891','2892','2880','2883','2885','2887',
  '2412','4904','3045','2498',
  '1301','1303','1326','6505','2002','2308','2327','6669','2317',
  '1101','1102','2207','2105','2823','2812','5871','6415','2395',
  '3661','6523','2610','2618','2615','2609','2603','3006','3665','4967',
  '6443','2474','2049','3017','2360','6533','3576','3044','6153','2929',
];

function buildBatches(arr: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchIntraday(): Promise<StockItem[]> {
  const batches = buildBatches(STOCKS, 30);
  const allItems: Record<string, string>[] = [];
  await Promise.all(batches.map(async (batch) => {
    const exCh = batch.map(c => `tse_${c}.tw`).join('|');
    try {
      const res = await fetch(
        `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw' } }
      );
      const data = await res.json();
      if (data?.msgArray) allItems.push(...(data.msgArray as Record<string, string>[]));
    } catch { /* 單批失敗不影響 */ }
  }));
  return allItems.flatMap(item => {
    const curr  = parseFloat(item.z && item.z !== '-' ? item.z : (item.pz || item.y || '0'));
    const prev  = parseFloat(item.y || '0');
    const open  = parseFloat(item.o && item.o !== '-' ? item.o : (curr > 0 ? String(curr) : '0'));
    const high  = parseFloat(item.h && item.h !== '-' ? item.h : (curr > 0 ? String(curr) : '0'));
    const low   = parseFloat(item.l && item.l !== '-' ? item.l : (curr > 0 ? String(curr) : '0'));
    const vol   = parseFloat(item.v || '0');
    if (curr <= 0 || prev <= 0 || !item.n) return [];
    const change    = curr - prev;
    const changePct = (change / prev) * 100;
    return [{
      code: item.c, name: item.n,
      price: parseFloat(curr.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      volume: vol, turnover: parseFloat((vol * curr).toFixed(0)),
      open, high, low,
    }];
  });
}

export async function GET() {
  try {
    // 先嘗試盤後全市場資料（最準確漲停）
    let stocks: StockItem[] = [];
    try {
      stocks = await fetchAllStocksAfterHours();
    } catch {
      // 失敗則用盤中固定清單
      stocks = await fetchIntraday();
    }

    if (stocks.length === 0) {
      stocks = await fetchIntraday();
    }

    const byGain    = [...stocks].sort((a, b) => b.changePct - a.changePct);
    const byLoss    = [...stocks].sort((a, b) => a.changePct - b.changePct);
    const byVolume  = [...stocks].sort((a, b) => b.volume   - a.volume);
    const byTurn    = [...stocks].sort((a, b) => b.turnover  - a.turnover);
    // 漲停：漲幅 >= 9.5%，只取普通股（Code 4碼數字）
    const limitUp   = byGain.filter(s => s.changePct >= 9.5 && /^\d{4}$/.test(s.code));

    return NextResponse.json({
      gainers:  byGain.slice(0, 20),
      losers:   byLoss.slice(0, 20),
      volume:   byVolume.slice(0, 20),
      turnover: byTurn.slice(0, 20),
      limitup:  limitUp.slice(0, 20),
      total:    stocks.length,
    });
  } catch {
    return NextResponse.json({ gainers: [], losers: [], volume: [], turnover: [], limitup: [], total: 0 });
  }
}
