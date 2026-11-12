import { NextRequest, NextResponse } from 'next/server';
import { fetchTWQuote, fetchUSQuote } from '@/lib/fetchQuote';

export async function GET(req: NextRequest) {
  const code   = req.nextUrl.searchParams.get('code') || '';
  const market = req.nextUrl.searchParams.get('market') || 'TW';

  if (!code) {
    return NextResponse.json({ error: '請提供股票代碼' }, { status: 400 });
  }

  const quote = market === 'US'
    ? await fetchUSQuote(code)
    : await fetchTWQuote(code);

  if (!quote) {
    return NextResponse.json({ error: `找不到 ${code}` }, { status: 404 });
  }

  return NextResponse.json(quote);
}
