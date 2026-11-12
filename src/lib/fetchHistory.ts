import { CandleData } from '@/types/stock';

// ─── TWSE 官方 API（台股主要來源）────────────────────────────────────────────
async function fetchTWSEMonth(code: string, yyyymm: string): Promise<CandleData[]> {
  const date = yyyymm + '01';
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${code}&response=json`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    if (data.stat !== 'OK' || !data.data) return [];

    return data.data.map((row: string[]) => {
      // row: [日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, 漲跌價差, 成交筆數]
      const dateParts = row[0].split('/');
      const year = parseInt(dateParts[0]) + 1911;
      const month = dateParts[1].padStart(2, '0');
      const day = dateParts[2].padStart(2, '0');
      const isoDate = `${year}-${month}-${day}`;

      const open  = parseFloat(row[3].replace(/,/g, ''));
      const high  = parseFloat(row[4].replace(/,/g, ''));
      const low   = parseFloat(row[5].replace(/,/g, ''));
      const close = parseFloat(row[6].replace(/,/g, ''));
      const vol   = parseInt(row[1].replace(/,/g, ''), 10);

      if (isNaN(open) || isNaN(close)) return null;
      return { time: isoDate, open, high, low, close, volume: vol } as CandleData;
    }).filter(Boolean) as CandleData[];
  } catch {
    return [];
  }
}

// ─── OTC 官方 API（上櫃股）──────────────────────────────────────────────────
async function fetchOTCMonth(code: string, yyyymm: string): Promise<CandleData[]> {
  const [year, month] = yyyymm.split('-');
  const twYear = parseInt(year) - 1911;
  const date = `${twYear}/${month}/01`;
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${encodeURIComponent(date)}&stkno=${code}&o=json`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    if (!data.aaData) return [];

    return data.aaData.map((row: string[]) => {
      // row: [日期, 成交股數, 成交金額, 開盤, 最高, 最低, 收盤, 漲跌, 成交筆]
      const dateParts = row[0].split('/');
      const twY = parseInt(dateParts[0]);
      const yr = twY + 1911;
      const mn = dateParts[1].padStart(2, '0');
      const dy = dateParts[2].padStart(2, '0');
      const isoDate = `${yr}-${mn}-${dy}`;

      const open  = parseFloat(row[3].replace(/,/g, ''));
      const high  = parseFloat(row[4].replace(/,/g, ''));
      const low   = parseFloat(row[5].replace(/,/g, ''));
      const close = parseFloat(row[6].replace(/,/g, ''));
      const vol   = parseInt(row[1].replace(/,/g, ''), 10);

      if (isNaN(open) || isNaN(close)) return null;
      return { time: isoDate, open, high, low, close, volume: vol } as CandleData;
    }).filter(Boolean) as CandleData[];
  } catch {
    return [];
  }
}

// ─── 產生過去 N 個月的 YYYYMM 清單 ──────────────────────────────────────────
function pastMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear().toString();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${yyyy}-${mm}`);
  }
  return months;
}

// ─── Yahoo Finance（備用，美股主要來源）──────────────────────────────────────
async function fetchYahooHistory(symbol: string): Promise<CandleData[]> {
  const endpoints = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com',
          'Origin': 'https://finance.yahoo.com',
        },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp || [];
      const q = result.indicators?.quote?.[0];
      if (!q || timestamps.length === 0) continue;

      const candles: CandleData[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (!q.open?.[i] || !q.close?.[i]) continue;
        const date = new Date(timestamps[i] * 1000);
        candles.push({
          time:   date.toISOString().split('T')[0],
          open:   parseFloat(q.open[i].toFixed(2)),
          high:   parseFloat(q.high[i].toFixed(2)),
          low:    parseFloat(q.low[i].toFixed(2)),
          close:  parseFloat(q.close[i].toFixed(2)),
          volume: q.volume?.[i] || 0,
        });
      }
      if (candles.length > 0) {
        return candles.sort((a, b) => a.time.localeCompare(b.time));
      }
    } catch {
      continue;
    }
  }
  return [];
}

// ─── 主要匯出 ────────────────────────────────────────────────────────────────
export async function fetchTWHistory(code: string, market: 'TSE' | 'OTC' | 'TW'): Promise<CandleData[]> {
  try {
    const months = pastMonths(13); // 取 13 個月確保超過 1 年

    if (market === 'OTC') {
      // 上櫃：用 TPEx 官方 API
      const allData = await Promise.all(months.map(m => fetchOTCMonth(code, m)));
      const combined = allData.flat().sort((a, b) => a.time.localeCompare(b.time));
      if (combined.length > 0) return combined;
    } else {
      // 上市（TSE 或 TW）：用 TWSE 官方 API
      const allData = await Promise.all(months.map(m => fetchTWSEMonth(code, m.replace('-', ''))));
      const combined = allData.flat().sort((a, b) => a.time.localeCompare(b.time));
      if (combined.length > 0) return combined;
    }

    // Fallback: Yahoo Finance
    const suffix = market === 'OTC' ? '.TWO' : '.TW';
    return await fetchYahooHistory(code + suffix);
  } catch {
    return [];
  }
}

export async function fetchUSHistory(symbol: string): Promise<CandleData[]> {
  return await fetchYahooHistory(symbol);
}
