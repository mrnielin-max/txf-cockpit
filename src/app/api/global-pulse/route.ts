import { NextResponse } from 'next/server';

// 海外脈動：影響台指期開盤的外盤因子
const FACTORS = [
  { symbol: 'TSM',       name: '台積電 ADR',   group: '半導體', txfKey: true },
  { symbol: 'ES=F',      name: 'S&P 500 期貨', group: '美股期貨', txfKey: true },
  { symbol: 'NQ=F',      name: '那斯達克期貨', group: '美股期貨', txfKey: true },
  { symbol: '^SOX',      name: '費城半導體',   group: '半導體', txfKey: true },
  { symbol: '^VIX',      name: 'VIX 恐慌指數', group: '風險', txfKey: true },
  { symbol: '^TNX',      name: '美債 10 年',   group: '利率', txfKey: true },
  { symbol: '^TYX',      name: '美債 30 年',   group: '利率', txfKey: false },
  { symbol: 'DX-Y.NYB',  name: '美元指數',     group: '匯率', txfKey: true },
  { symbol: 'USDJPY=X',  name: '美元/日圓',    group: '匯率', txfKey: true },
  { symbol: 'USDTWD=X',  name: '美元/台幣',    group: '匯率', txfKey: true },
  { symbol: '^N225',     name: '日經 225',     group: '亞洲', txfKey: false },
  { symbol: '^KS11',     name: '韓國 KOSPI',   group: '亞洲', txfKey: false },
  { symbol: 'GC=F',      name: '黃金期貨',     group: '商品', txfKey: false },
  { symbol: 'CL=F',      name: 'WTI 原油',     group: '商品', txfKey: false },
  { symbol: 'BTC-USD',   name: '比特幣',       group: '風險', txfKey: false },
];

async function fetchOne(f: { symbol: string; name: string; group: string; txfKey: boolean }) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(f.symbol)}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return { ...f, price: 0, change: 0, changePct: 0, ok: false };
    const price = meta.regularMarketPrice ?? 0;
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? 0;
    const change = price - prev;
    const changePct = prev > 0 ? (change / prev) * 100 : 0;
    return {
      ...f,
      price: parseFloat(price.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      currency: meta.currency || '',
      marketTime: meta.regularMarketTime || 0,
      ok: true,
    };
  } catch {
    return { ...f, price: 0, change: 0, changePct: 0, ok: false };
  }
}

export async function GET() {
  const results = await Promise.all(FACTORS.map(fetchOne));
  // TSM ADR 折算 2330 參考價：ADR 1 股 = 普通股 5 股
  const tsm = results.find(r => r.symbol === 'TSM');
  const usdtwd = results.find(r => r.symbol === 'USDTWD=X');
  let tsmImplied = 0;
  if (tsm?.ok && usdtwd?.ok) {
    tsmImplied = Math.round((tsm.price * usdtwd.price) / 5);
  }
  return NextResponse.json({ factors: results, tsmImplied, fetchedAt: new Date().toISOString() });
}
