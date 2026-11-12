import { NextResponse } from 'next/server';

const parse = (item: Record<string, string>) => {
  const curr = parseFloat(item.z && item.z !== '-' ? item.z : (item.pz || item.y || '0'));
  const prev = parseFloat(item.y || '0');
  const change = curr - prev;
  const changePct = prev > 0 ? (change / prev) * 100 : 0;
  return {
    name: item.n || '',
    value: parseFloat(curr.toFixed(2)),
    prev: parseFloat(prev.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    volume: parseFloat(item.v || '0'),
  };
};

async function fetchFutures(commodityID: string) {
  const res = await fetch('https://mis.taifex.com.tw/futures/api/getQuoteList', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://mis.taifex.com.tw',
      'Referer': 'https://mis.taifex.com.tw/futures/zh/RegularTrading/GroupQuery',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ MarketType: '1', CommodityID: commodityID }),
    next: { revalidate: 15 },
  });
  const d = await res.json();
  const qs: Record<string, string>[] = d?.RtData?.QuoteList || [];
  // 找近月合約：SymbolID 含 -M 且有成交價
  const near = qs.find(q => q.SymbolID?.includes('-M') && q.CLastPrice);
  if (!near) return null;
  const curr = parseFloat(near.CLastPrice || '0');
  const ref  = parseFloat(near.CRefPrice  || '0');
  const diff = parseFloat(near.CDiff      || '0');
  const diffRate = parseFloat(near.CDiffRate || '0');
  return {
    name:      near.DispCName || commodityID,
    value:     curr,
    prev:      ref,
    change:    diff,
    changePct: diffRate,
    volume:    parseFloat(near.CTotalVolume || '0'),
    open:      parseFloat(near.COpenPrice  || '0'),
    high:      parseFloat(near.CHighPrice  || '0'),
    low:       parseFloat(near.CLowPrice   || '0'),
  };
}

export async function GET() {
  try {
    // 加權指數 + 櫃買指數
    const res1 = await fetch(
      'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|otc_o00.tw&json=1&delay=0',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw' }, next: { revalidate: 15 } }
    );
    const d1 = await res1.json();
    const items1: Record<string, string>[] = d1?.msgArray || [];
    const taiex = items1.find(i => i.c === 't00');
    const otc   = items1.find(i => i.c === 'o00');

    // 台指期 + 台指電子盤 — 用 TAIFEX 官方 API
    const [fitx, fite] = await Promise.all([
      fetchFutures('TXF').catch(() => null),
      fetchFutures('TE').catch(() => null),
    ]);

    return NextResponse.json({
      taiex: taiex ? parse(taiex) : null,
      otc:   otc   ? parse(otc)  : null,
      fitx,
      fite,
    });
  } catch {
    return NextResponse.json({ taiex: null, otc: null, fitx: null, fite: null });
  }
}
