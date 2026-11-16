// TAIFEX MIS 即時報價共用函式庫
// 教訓（2026-11-16）：MarketType=1  feed 可能整天停滯（回傳上一交易日資料），
// MarketType=0（-F 後綴、含 TXF-S 即時現貨）才是真即時。必須雙源並抓、
// 以 CDate+CTime 比較新舊，回傳較新的清單，不可寫死只用 MarketType=1。

export type MisQuote = Record<string, string>;

const MIS_URL = 'https://mis.taifex.com.tw/futures/api/getQuoteList';

const MIS_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://mis.taifex.com.tw',
  'Referer': 'https://mis.taifex.com.tw/futures/zh/RegularTrading/GroupQuery',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// 單一 feed 抓取。revalidateSec 控制 Next 資料快取（避免多路由同時洗 TAIFEX）。
export async function fetchMisRawList(
  marketType: '0' | '1',
  commodityID = 'TXF',
  revalidateSec = 5,
  timeout = 12000,
): Promise<MisQuote[]> {
  try {
    const res = await fetch(MIS_URL, {
      method: 'POST',
      headers: MIS_HEADERS,
      body: JSON.stringify({ MarketType: marketType, CommodityID: commodityID }),
      signal: AbortSignal.timeout(timeout),
      next: { revalidate: revalidateSec },
    } as RequestInit);
    const d = await res.json();
    if (d?.RtCode !== '0' || !d?.RtData?.QuoteList) return [];
    return d.RtData.QuoteList as MisQuote[];
  } catch {
    return [];
  }
}

// 清單新鮮度 = 所有報價中最大的 CDate+CTime
function freshness(list: MisQuote[]): string {
  let best = '';
  for (const q of list) {
    const t = (q.CDate || '') + (q.CTime || '');
    if (t.length >= 8 && t > best) best = t;
  }
  return best;
}

// 雙源並抓，回傳較新的一份（同樣新時優先 MarketType=0 即時盤）
export async function fetchMisQuoteList(
  commodityID = 'TXF',
  revalidateSec = 5,
): Promise<{ quotes: MisQuote[]; marketType: '0' | '1'; fresh: string }> {
  const [l0, l1] = await Promise.all([
    fetchMisRawList('0', commodityID, revalidateSec),
    fetchMisRawList('1', commodityID, revalidateSec),
  ]);
  const f0 = freshness(l0);
  const f1 = freshness(l1);
  if (l0.length && f0 >= f1) return { quotes: l0, marketType: '0', fresh: f0 };
  if (l1.length) return { quotes: l1, marketType: '1', fresh: f1 };
  return { quotes: l0, marketType: '0', fresh: f0 };
}
