import { NextResponse } from 'next/server';
import { fetchMisQuoteList, fetchMisRawList } from '@/lib/taifexMis';
import { spotSession, txfSession, teSession } from '@/lib/sessionState';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

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
  // TXF 走雙源取新（MT1 可能整天停滯在上一交易日）；其他商品（TE）走 MT1 全量清單
  const quotes = commodityID === 'TXF'
    ? (await fetchMisQuoteList('TXF')).quotes
    : await fetchMisRawList('1', commodityID);
  // 近月：該商品單月合約（排除價差組合）中成交量最大者
  // 注意：TE（電子盤）feed 的 SymbolID 前綴是 TXF（如 TXFK6-M），不是 TE！
  const prefix = commodityID === 'TE' ? 'TXF' : commodityID;
  const re = new RegExp(`^${prefix}[A-Z]\\d-[MF]$`);
  const cs = quotes.filter(q => re.test(q.SymbolID || '') && q.CLastPrice && q.CLastPrice !== '-');
  let near: Record<string, string> | undefined;
  let maxVol = -1;
  for (const c of cs) {
    const v = parseFloat(c.CTotalVolume || '0');
    if (v > maxVol) { maxVol = v; near = c; }
  }
  if (!near) return null;
  const curr = parseFloat(near.CLastPrice || '0');
  const ref  = parseFloat(near.CRefPrice  || '0');
  const diff = parseFloat(near.CDiff      || '0');
  const diffRate = parseFloat(near.CDiffRate || '0');
  // 最後成交時間（收盤後凍結顯示用）
  const ct = near.CTime || '';
  const lastTradeTime = ct.length >= 6 ? `${ct.slice(0, 2)}:${ct.slice(2, 4)}:${ct.slice(4, 6)}` : '';
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
    date:      near.CDate || '',
    time:      near.CTime || '',
    lastTradeTime,
  };
}

export async function GET() {
  try {
    // 加權指數 + 櫃買指數
    const res1 = await fetch(
      'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw|otc_o00.tw&json=1&delay=0',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://mis.twse.com.tw' }, next: { revalidate: 5 } }
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
      sessions: { spot: spotSession(), fitx: txfSession(), fite: teSession() }, // 收盤後顯示最終價+收盤標籤
    }, NO_STORE);
  } catch {
    return NextResponse.json({ taiex: null, otc: null, fitx: null, fite: null }, NO_STORE);
  }
}
