import { NextRequest, NextResponse } from 'next/server';
import { fetchTWHistory, fetchUSHistory } from '@/lib/fetchHistory';

export async function GET(req: NextRequest) {
  const code   = req.nextUrl.searchParams.get('code') || '';
  const market = (req.nextUrl.searchParams.get('market') || 'TSE') as 'TSE' | 'OTC' | 'US';

  if (!code) {
    return NextResponse.json({ error: '請提供股票代碼' }, { status: 400 });
  }

  const candles = market === 'US'
    ? await fetchUSHistory(code)
    : await fetchTWHistory(code, market as 'TSE' | 'OTC');

  return NextResponse.json(candles);
}
