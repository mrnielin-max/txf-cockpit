import { NextResponse } from 'next/server';

const INDICES = [
  // 美股
  { symbol: '^DJI',   name: '道瓊指數',     region: '美股' },
  { symbol: '^GSPC',  name: 'S&P 500',      region: '美股' },
  { symbol: '^IXIC',  name: '那斯達克',     region: '美股' },
  { symbol: '^SOX',   name: '費城半導體',   region: '美股' },
  // 亞洲
  { symbol: '^TWII',  name: '台灣加權',     region: '亞洲' },
  { symbol: '^KS11',  name: '韓國綜合',     region: '亞洲' },
  { symbol: '^HSI',   name: '港股恒生',     region: '亞洲' },
  { symbol: '^N225',  name: '日經225',      region: '亞洲' },
  // 歐洲
  { symbol: '^FTSE',  name: '富時100',      region: '歐洲' },
  { symbol: '^GDAXI', name: '德國DAX',      region: '歐洲' },
  // 外匯
  { symbol: 'DX-Y.NYB', name: '美元指數',  region: '外匯' },
  { symbol: 'USDTWD=X',  name: '美元/台幣', region: '外匯' },
  // 商品
  { symbol: 'GC=F',   name: '黃金',         region: '商品' },
  { symbol: 'CL=F',   name: 'WTI原油',      region: '商品' },
];

export async function GET() {
  const results = await Promise.all(INDICES.map(async idx => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(idx.symbol)}?interval=1d&range=2d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 300 },
      });
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta || {};
      const price    = meta.regularMarketPrice ?? 0;
      const prev     = meta.previousClose ?? 0;
      const change   = price - prev;
      const changePct = prev > 0 ? (change / prev) * 100 : 0;
      return {
        ...idx,
        price:     parseFloat(price.toFixed(2)),
        change:    parseFloat(change.toFixed(2)),
        changePct: parseFloat(changePct.toFixed(2)),
      };
    } catch {
      return { ...idx, price: 0, change: 0, changePct: 0 };
    }
  }));
  return NextResponse.json(results);
}
