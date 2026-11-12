import { NextRequest, NextResponse } from 'next/server'

interface CalendarEvent {
  date: string        // YYYY-MM-DD
  title: string
  type: 'earnings' | 'dividend' | 'fed' | 'economic' | 'market' | 'stock'
  impact: 'high' | 'medium' | 'low'
  description: string
  time?: string
}

// 已知 FOMC 2025/2026 會議日期
const FOMC_DATES_2025 = [
  '2025-07-30', '2025-09-17', '2025-11-05', '2025-12-10',
]
const FOMC_DATES_2026 = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16',
]

// 已知台灣央行理監事會議
const CBC_DATES_2025 = ['2025-09-18', '2025-12-18']
const CBC_DATES_2026 = ['2026-03-19', '2026-06-18', '2026-09-17', '2026-12-17']

// 美國重要經濟數據發布（每月估算）
function getMonthlyEconomicEvents(year: number, month: number): CalendarEvent[] {
  const events: CalendarEvent[] = []
  // CPI 通常第2週
  const cpiDay = new Date(year, month - 1, 10)
  events.push({
    date: cpiDay.toISOString().split('T')[0],
    title: `CPI 消費者物價指數（${year}/${month}月）`,
    type: 'economic',
    impact: 'high',
    description: '美國通膨指標，影響Fed利率政策預期，對股市影響重大。若高於預期→股市承壓；低於預期→股市回升。',
    time: '21:30 (台灣時間)',
  })
  // NFP 通常第1個週五，近似第5日
  const nfpDay = new Date(year, month - 1, 5)
  events.push({
    date: nfpDay.toISOString().split('T')[0],
    title: `非農就業人數（NFP）（${year}/${month}月）`,
    type: 'economic',
    impact: 'high',
    description: '美國就業市場晴雨表，超預期強勁→Fed延緩降息，股市震盪；弱於預期→降息預期升溫。',
    time: '21:30 (台灣時間)',
  })
  // PCE 通常月底
  const pceDay = new Date(year, month - 1, 28)
  events.push({
    date: pceDay.toISOString().split('T')[0],
    title: `PCE 個人消費支出物價（${year}/${month}月）`,
    type: 'economic',
    impact: 'medium',
    description: 'Fed首選通膨指標，比CPI更受聯準會重視，直接影響利率點陣圖預期。',
    time: '21:30 (台灣時間)',
  })
  return events
}

// 台股除息除權旺季提示
function getTWDividendSeason(code: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const now = new Date()
  const month = now.getMonth() + 1
  // 台股除息旺季 6-9月
  if (month >= 5 && month <= 8) {
    events.push({
      date: new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0],
      title: `${code} 除息/除權基準日（估算）`,
      type: 'dividend',
      impact: 'high',
      description: '台股配息旺季。除息日前股價通常有填息預期支撐；除息後需觀察填息能力，是判斷公司體質的重要指標。',
    })
  }
  return events
}

// 法說會估算（依季度）
function getEarningsEvent(code: string, name: string, market: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const now = new Date()
  const month = now.getMonth() + 1

  // 台股法說會通常在1月(Q4)、4月(Q1)、8月(Q2)、11月(Q3)
  const twEarningsMonths = [1, 4, 8, 11]
  // 美股財報通常在1月、4月、7月、10月
  const usEarningsMonths = [1, 4, 7, 10]

  const isTW = market === 'TW' || market === 'TSE' || market === 'OTC'
  const earningsMonths = isTW ? twEarningsMonths : usEarningsMonths

  // 找下一個財報月
  let nextMonth = earningsMonths.find(m => m >= month)
  if (!nextMonth) nextMonth = earningsMonths[0]

  const daysUntil = ((nextMonth - month + 12) % 12) * 30 + 10
  if (daysUntil <= 15) {
    const earningsDate = new Date(now.getTime() + daysUntil * 86400000)
    events.push({
      date: earningsDate.toISOString().split('T')[0],
      title: `${name}（${code}）${isTW ? '法說會' : 'Earnings Report'}`,
      type: 'earnings',
      impact: 'high',
      description: isTW
        ? `${name} 季度法人說明會。重點關注：營收展望、毛利率變化、AI相關訂單能見度、下季EPS指引。法說會結果直接影響短期股價走向。`
        : `${name} quarterly earnings release. Key metrics: EPS vs consensus, revenue guidance, margin outlook, and management commentary on AI/macro headwinds.`,
    })
  }
  return events
}

// 台灣重要市場事件
function getTWMarketEvents(): CalendarEvent[] {
  const now = new Date()
  const events: CalendarEvent[] = []

  // MSCI 季度調整（3/6/9/12月）
  const msciMonths = [3, 6, 9, 12]
  const nextMsci = msciMonths.find(m => m > now.getMonth() + 1) || 3
  const msciDays = (nextMsci - (now.getMonth() + 1)) * 30
  if (msciDays <= 15) {
    events.push({
      date: new Date(now.getTime() + msciDays * 86400000).toISOString().split('T')[0],
      title: 'MSCI 季度指數調整生效',
      type: 'market',
      impact: 'high',
      description: 'MSCI指數季度調整，台股成分股異動直接影響外資被動資金流向。調升比重→外資買入；調降比重→外資賣出。',
    })
  }

  // 台灣加權指數期貨結算（每月第3個週三）
  events.push({
    date: new Date(now.getTime() + 8 * 86400000).toISOString().split('T')[0],
    title: '台指期結算日（估算）',
    type: 'market',
    impact: 'medium',
    description: '台股期貨月結算日，空方主動回補或多方獲利了結，盤面可能出現波動放大，注意尾盤操作風險。',
  })

  return events
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code') || ''
  const name = searchParams.get('name') || code
  const market = searchParams.get('market') || 'TW'

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const in15Days = new Date(now.getTime() + 15 * 86400000).toISOString().split('T')[0]

  let events: CalendarEvent[] = []

  // 1. FOMC 會議
  const allFomc = [...FOMC_DATES_2025, ...FOMC_DATES_2026]
  allFomc.forEach(date => {
    if (date >= today && date <= in15Days) {
      events.push({
        date,
        title: 'FOMC 聯準會利率決策會議',
        type: 'fed',
        impact: 'high',
        description: '美國聯邦公開市場委員會利率決策，全球最重要的貨幣政策事件。維持→市場平穩；升息→股市承壓；降息→股市狂歡。結束後Fed主席記者會同樣關鍵。',
        time: '03:00 (台灣時間，次日凌晨)',
      })
    }
  })

  // 2. 台灣央行
  const allCbc = [...CBC_DATES_2025, ...CBC_DATES_2026]
  allCbc.forEach(date => {
    if (date >= today && date <= in15Days) {
      events.push({
        date,
        title: '台灣央行理監事聯席會議',
        type: 'fed',
        impact: 'high',
        description: '台灣中央銀行利率決策與匯率政策說明。新台幣走勢、外資匯入成本直接影響台股外資動向。',
        time: '15:30 (台灣時間)',
      })
    }
  })

  // 3. 每月經濟數據
  const curYear = now.getFullYear()
  const curMonth = now.getMonth() + 1
  const nextMonth = curMonth === 12 ? 1 : curMonth + 1
  const nextYear = curMonth === 12 ? curYear + 1 : curYear
  const monthlyEvents = [
    ...getMonthlyEconomicEvents(curYear, curMonth),
    ...getMonthlyEconomicEvents(nextYear, nextMonth),
  ]
  monthlyEvents.forEach(e => {
    if (e.date >= today && e.date <= in15Days) events.push(e)
  })

  // 4. 個股法說會
  events.push(...getEarningsEvent(code, name, market))

  // 5. 台股市場事件
  if (market !== 'US') {
    events.push(...getTWMarketEvents())
    events.push(...getTWDividendSeason(code))
  }

  // 6. 美股特定事件
  if (market === 'US') {
    // S&P 500 指數再平衡
    events.push({
      date: new Date(now.getTime() + 10 * 86400000).toISOString().split('T')[0],
      title: 'S&P 500 季度再平衡（估算）',
      type: 'market',
      impact: 'medium',
      description: 'S&P 500指數季度權重調整，影響被動型基金強制買賣方向，成分股變動前後股價波動加大。',
    })

    // 美股期貨結算（四巫日，3/6/9/12月第3個週五）
    events.push({
      date: new Date(now.getTime() + 5 * 86400000).toISOString().split('T')[0],
      title: '美股三重結算日（估算）',
      type: 'market',
      impact: 'medium',
      description: '股票期貨、指數期貨、個股選擇權同日結算，成交量大幅放大，盤面波動劇烈，謹慎使用槓桿。',
    })
  }

  // 排序 + 去重 + 過濾15天內
  const seen = new Set<string>()
  events = events
    .filter(e => e.date >= today && e.date <= in15Days)
    .filter(e => {
      const key = `${e.date}_${e.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ events, generatedAt: now.toISOString() })
}
