import { NextRequest, NextResponse } from 'next/server';

interface Point { t: string; v: number }

// TWSE 官方分時指數（加權指數，每秒一筆，約 3241 筆）
async function fetchTAIEXIntraday(): Promise<Point[]> {
  const url = 'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?response=json';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.twse.com.tw',
      },
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.stat !== 'OK' || !data.data) return [];

    // 每 60 筆（60 秒）採樣一次 → 約每 1 分鐘一個點
    const rows: string[][] = data.data;
    const sampled = rows.filter((_, i) => i % 60 === 0);
    return sampled.map(row => ({
      t: row[0],  // "09:05:00"
      v: parseFloat(row[1].replace(/,/g, '')),  // 加權指數
    })).filter(p => !isNaN(p.v));
  } catch {
    return [];
  }
}

// Yahoo Finance 分時（備用：OTC / 台指期）
async function fetchYahooIntraday(symbol: string): Promise<Point[]> {
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com',
        },
        next: { revalidate: 60 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const timestamps: number[] = result.timestamp || [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      const points: Point[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        points.push({ t: `${hh}:${mm}`, v: parseFloat(closes[i]!.toFixed(2)) });
      }
      if (points.length > 0) return points;
    } catch {
      continue;
    }
  }
  return [];
}

export async function GET(req: NextRequest) {
  const tab = req.nextUrl.searchParams.get('tab') || 'taiex';

  let points: Point[] = [];

  if (tab === 'taiex') {
    // 加權指數：TWSE 官方資料優先
    points = await fetchTAIEXIntraday();
    if (points.length === 0) {
      // Fallback: Yahoo Finance
      points = await fetchYahooIntraday('^TWII');
    }
  } else if (tab === 'otc') {
    // 櫃買指數：Yahoo Finance
    points = await fetchYahooIntraday('^TWOII');
  } else if (tab === 'fitx') {
    // 台指期：Yahoo Finance
    points = await fetchYahooIntraday('FITX00.TWO');
  }

  return NextResponse.json({ points });
}
