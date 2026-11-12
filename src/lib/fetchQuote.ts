import { StockQuote } from '@/types/stock';

export async function fetchTWQuote(code: string): Promise<StockQuote | null> {
  const markets = ['tse', 'otc'];
  for (const market of markets) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${market}_${code}.tw&json=1&delay=0`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 30 },
      });
      const data = await res.json();
      if (!data.msgArray || data.msgArray.length === 0) continue;
      const d = data.msgArray[0];
      // 有股票資料但沒有成交價（盤後/非交易時段），用昨收 fallback
      if (!d.n) continue;

      const prev  = parseFloat(d.y) || 0;
      // z = 成交價，盤後為 '-'，fallback 用昨收
      const rawZ  = d.z && d.z !== '-' ? parseFloat(d.z) : null;
      const price = rawZ ?? prev;
      const change = rawZ != null ? price - prev : 0;

      return {
        code:      d.c,
        name:      d.n,
        market:    market === 'tse' ? 'TSE' : 'OTC',
        price,
        prev,
        change,
        changePct: prev > 0 ? (change / prev) * 100 : 0,
        open:      parseFloat(d.o) || price,
        high:      parseFloat(d.h) || price,
        low:       parseFloat(d.l) || price,
        volume:    d.v ? Math.round(parseInt(d.v) / 1000) : 0,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchUSQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 },
    });
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price  = meta.regularMarketPrice;
    const prev   = meta.previousClose || meta.chartPreviousClose;
    const change = price - prev;

    return {
      code:      symbol.toUpperCase(),
      name:      meta.longName || meta.shortName || symbol,
      market:    'US',
      price,
      prev,
      change,
      changePct: prev > 0 ? (change / prev) * 100 : 0,
      open:      meta.regularMarketOpen || price,
      high:      meta.regularMarketDayHigh || price,
      low:       meta.regularMarketDayLow || price,
      volume:    meta.regularMarketVolume || 0,
    };
  } catch {
    return null;
  }
}
