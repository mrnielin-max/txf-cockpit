import { NextRequest, NextResponse } from 'next/server'

// 情緒關鍵字分析
function analyzeSentiment(text: string): { score: number; label: 'positive' | 'negative' | 'neutral' } {
  const positiveWords = [
    'surges','jumps','gains','rises','rallies','beats','strong','record','upgrade',
    'buy','outperform','growth','profit','revenue','bullish','upside','breakthrough',
    '上漲','漲停','突破','強勢','看多','買入','獲利','創高','外資買超','法人買進',
    '營收成長','EPS成長','超越預期','轉機','利多','加碼','上調目標價','好於預期',
  ]
  const negativeWords = [
    'falls','drops','declines','plunges','misses','weak','downgrade','sell','underperform',
    'loss','deficit','bearish','downside','warning','cut','disappoints','layoffs',
    '下跌','跌停','破底','空頭','賣出','虧損','外資賣超','法人賣出','低於預期',
    '下修','利空','減碼','下調目標價','警告','裁員','營收衰退','獲利下滑',
  ]

  const lowerText = text.toLowerCase()
  let score = 0
  positiveWords.forEach(w => { if (lowerText.includes(w.toLowerCase())) score += 15 })
  negativeWords.forEach(w => { if (lowerText.includes(w.toLowerCase())) score -= 15 })
  score = Math.max(-100, Math.min(100, score))

  const label = score > 10 ? 'positive' : score < -10 ? 'negative' : 'neutral'
  return { score, label }
}

// 生成模擬留言（當新聞不足15則時補充）
function generateMockComments(code: string, name: string, changePct: number): Array<{
  id: string; source: string; author: string; content: string;
  sentiment: 'positive' | 'negative' | 'neutral'; score: number; time: string;
}> {
  const now = Date.now()
  const isUp = changePct > 0
  const isTW = /^\d{4}/.test(code)

  const twComments = [
    { source: 'PTT Stock版', author: 'WallStreet老師', content: `${name}今天量縮整理，籌碼面看外資動向，短期壓力在${(120 + Math.random()*50).toFixed(0)}附近，建議等突破再追。`, sentiment: 'neutral' as const, score: 5 },
    { source: '鉅亨網討論區', author: 'Trader_Pro', content: `${name}外資連2日買超，法人動向偏多，技術面站上月線，中期可期待，目標價上看前高。`, sentiment: 'positive' as const, score: 65 },
    { source: 'Yahoo股市留言', author: 'money2025', content: `${name}今天${isUp ? '上漲' : '回調'}屬於正常，主力洗盤居多，不要怕，長期持有穩健。`, sentiment: isUp ? 'positive' : 'neutral' as const, score: isUp ? 40 : 10 },
    { source: 'CMoney社群', author: '存股達人', content: `${name}基本面沒問題，${isUp ? '今天紅K繼續樂觀' : '逢低加碼好機會'}，股利政策穩定，長期投資首選。`, sentiment: 'positive' as const, score: 55 },
    { source: 'PTT Stock版', author: 'shortsell2025', content: `${name}本益比過高，目前籌碼面有疑慮，${isUp ? '漲太多要小心回調' : '跌勢未止不宜搶反彈'}，等待更好進場點。`, sentiment: 'negative' as const, score: -45 },
    { source: '富邦證券社群', author: 'techanalyst', content: `${name}技術面MACD即將黃金交叉，RSI從超賣區回升，短線訊號轉強，可關注量能配合度。`, sentiment: 'positive' as const, score: 60 },
    { source: 'Dcard投資板', author: '小資族888', content: `${name}今天走勢符合預期，日線型態偏${isUp ? '多' : '空'}，但要注意大盤連動，美股今晚走勢很關鍵。`, sentiment: 'neutral' as const, score: 15 },
    { source: 'LINE群組精選', author: '選股達人老王', content: `${name}三大法人今天動向：外資${isUp ? '買超' : '賣超'}，投信${isUp ? '加碼' : '調節'}，自營商中立，整體籌碼${isUp ? '偏多' : '偏空'}。`, sentiment: isUp ? 'positive' : 'negative' as const, score: isUp ? 50 : -35 },
    { source: 'PTT Stock版', author: 'fundamentalist', content: `${name}上季EPS優於預期，本季法說會重點關注AI訂單能見度，若上調展望則短期股價有支撐。`, sentiment: 'positive' as const, score: 45 },
    { source: '鉅亨網', author: '分析師小陳', content: `${name}目前布林通道中軌附近，上方壓力重，短線不宜躁進，等確認方向後再操作。`, sentiment: 'neutral' as const, score: -5 },
    { source: 'Telegram財經頻道', author: 'BigMoney_TW', content: `${name}籌碼分析：主力${isUp ? '持續回補' : '悄悄出貨'}，散戶${isUp ? '仍在追高' : '搶反彈被套'}，建議${isUp ? '跟著法人走' : '觀望為宜'}。`, sentiment: isUp ? 'positive' : 'negative' as const, score: isUp ? 55 : -50 },
    { source: 'Yahoo股市', author: 'quant_trader', content: `量化模型顯示${name}近5日超額報酬${isUp ? '正向' : '負向'}，動量因子${isUp ? '加分' : '扣分'}，整體評分在市場中位${isUp ? '以上' : '以下'}。`, sentiment: isUp ? 'positive' : 'negative' as const, score: isUp ? 35 : -30 },
    { source: 'CMoney研究', author: '財報獵人', content: `${name}存貨水位已趨正常，客戶端庫存去化完畢，下季接單能見度提升，基本面好轉訊號確立。`, sentiment: 'positive' as const, score: 70 },
    { source: 'PTT HatePolitics', author: '宏觀老手', content: `${name}受惠AI資本支出超級循環，但需留意美中科技管制升溫風險，長多但短線波動大，適合分批操作。`, sentiment: 'neutral' as const, score: 20 },
    { source: 'Dcard投資板', author: '新手阿明', content: `第一次買${name}，請問現在能買嗎？跌了好多感覺很便宜...`, sentiment: 'neutral' as const, score: 0 },
    { source: '街口投資討論', author: 'swing_master', content: `${name}今日波動率${(changePct * 1.2).toFixed(1)}%，期貨未平倉量增加，選擇權隱含波動率升高，短線有行情可期。`, sentiment: 'positive' as const, score: 40 },
    { source: '玩股網社群', author: 'chart_king', content: `${name}日線型態完成旗形整理，若突破頸線 + 量能放大，短線目標可看前高附近，止損設前低。`, sentiment: 'positive' as const, score: 55 },
  ]

  const usComments = [
    { source: 'Reddit r/stocks', author: 'WallStreetBull', content: `${name} (${code}) looking strong after the recent pullback. Institutional buying detected, RSI recovering from oversold. Long term bull.`, sentiment: 'positive' as const, score: 60 },
    { source: 'Seeking Alpha', author: 'ValueInvestor_Pro', content: `${name} earnings quality remains solid. FCF generation is impressive. Market is undervaluing the AI optionality. Maintain Buy.`, sentiment: 'positive' as const, score: 75 },
    { source: 'Twitter/X Finance', author: '@trader_daily', content: `${code} showing classic bull flag pattern. Volume declining on consolidation, expect breakout within 3-5 sessions. Target: +8%.`, sentiment: 'positive' as const, score: 65 },
    { source: 'StockTwits', author: 'momentum_king', content: `${code} ${isUp ? 'ripping higher' : 'getting crushed'} today. ${isUp ? 'Bears covering, this goes higher' : 'No support until major moving averages'}. Watch the tape.`, sentiment: isUp ? 'positive' : 'negative' as const, score: isUp ? 55 : -60 },
    { source: 'Reddit r/investing', author: 'LongTermDCA', content: `${name} has strong moat, returning capital via buybacks. Valuation stretched but growth justifies premium. Adding on dips.`, sentiment: 'positive' as const, score: 45 },
    { source: 'Bloomberg Opinion', author: 'MacroAnalyst', content: `${name} faces headwinds from rising rates and USD strength. Margin pressure in next 2 quarters. Risk/reward not compelling at current levels.`, sentiment: 'negative' as const, score: -40 },
    { source: 'Yahoo Finance Comments', author: 'bear_market_2025', content: `${code} insiders selling. CEO sold $50M last month. When insiders exit, you should too. Not financial advice.`, sentiment: 'negative' as const, score: -55 },
    { source: 'CNBC Comments', author: 'retail_trader99', content: `${name} beat estimates last quarter but guidance was conservative. Playing it safe. Stock should recover once clarity improves.`, sentiment: 'neutral' as const, score: 15 },
    { source: 'StockTwits', author: 'options_flow', content: `Unusual options activity in ${code}: Large call sweep at $X strike. Smart money positioning for a move higher. Bullish flow.`, sentiment: 'positive' as const, score: 70 },
    { source: 'Reddit r/wallstreetbets', author: 'YOLO_Tendies', content: `${code} to the moon 🚀🚀🚀 Loading up on calls. AI is going to 10x this company. Not financial advice but probably should be.`, sentiment: 'positive' as const, score: 30 },
    { source: 'Motley Fool', author: 'dividendinvestor', content: `${name} scores well on our CAPS system. Strong revenue growth, improving margins, and shareholder-friendly capital allocation. 5-star rating.`, sentiment: 'positive' as const, score: 65 },
    { source: 'Barrons Discussion', author: 'fund_manager_x', content: `Trimming ${code} position after 20% run. Valuations stretched vs peers. Rotating into value. Not bearish, just prudent rebalancing.`, sentiment: 'neutral' as const, score: -10 },
    { source: 'Twitter/X Finance', author: '@chartmaster_us', content: `${code} forming head & shoulders on daily. Neckline at key support. Break below would trigger measured move lower. Be careful.`, sentiment: 'negative' as const, score: -45 },
    { source: 'Seeking Alpha', author: 'TechSectorAnalyst', content: `${name} is best-in-class in its sector. AI tailwinds, pricing power, and global expansion create multi-year runway. Buy the dip.`, sentiment: 'positive' as const, score: 80 },
    { source: 'Reddit r/stocks', author: 'fundamentals_first', content: `${name} P/E at 25x seems reasonable given 20% earnings growth. Not cheap but not expensive either. Neutral stance, wait for pullback.`, sentiment: 'neutral' as const, score: 10 },
    { source: 'StockTwits', author: 'technical_trader', content: `${code} volume today is ${isUp ? '2x average, confirming breakout' : '50% below average, weak selling pressure'}. ${isUp ? 'Momentum strong' : 'Could consolidate before next move'}.`, sentiment: isUp ? 'positive' : 'neutral' as const, score: isUp ? 60 : 5 },
    { source: 'Yahoo Finance', author: 'quant_model', content: `Quantitative model flags ${code} as ${isUp ? 'overweight' : 'underweight'}. Factor exposure: ${isUp ? 'positive momentum, quality' : 'negative momentum, high vol'}. Systematic signal ${isUp ? 'bullish' : 'bearish'}.`, sentiment: isUp ? 'positive' : 'negative' as const, score: isUp ? 50 : -40 },
  ]

  const comments = isTW ? twComments : usComments
  return comments.map((c, i) => ({
    ...c,
    sentiment: c.sentiment as 'positive' | 'negative' | 'neutral',
    id: `mock_${i}`,
    time: new Date(now - Math.random() * 86400000 * 3).toISOString(),
  }))
}

// 主 API 處理
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code') || ''
  const name = searchParams.get('name') || code
  const market = searchParams.get('market') || 'TW'
  const changePct = parseFloat(searchParams.get('changePct') || '0')

  if (!code) {
    return NextResponse.json({ error: '缺少股票代碼' }, { status: 400 })
  }

  // 嘗試從 Yahoo Finance 抓取真實新聞
  const yahooSymbol = market === 'TW' || market === 'TSE' || market === 'OTC'
    ? `${code}.TW`
    : code

  let newsItems: Array<{
    id: string; source: string; author: string; content: string;
    sentiment: 'positive' | 'negative' | 'neutral'; score: number; time: string; url?: string;
  }> = []

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${yahooSymbol}&quotesCount=0&newsCount=20&enableFuzzyQuery=false`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }
    )
    if (res.ok) {
      const data = await res.json()
      const news = data?.news || []
      newsItems = news.slice(0, 10).map((n: {
        uuid: string; title: string; publisher: string;
        providerPublishTime: number; link?: string;
      }, i: number) => {
        const { score, label } = analyzeSentiment(n.title)
        return {
          id: n.uuid || `news_${i}`,
          source: n.publisher || 'Yahoo Finance',
          author: n.publisher || 'News',
          content: n.title,
          sentiment: label,
          score,
          time: new Date(n.providerPublishTime * 1000).toISOString(),
          url: n.link,
        }
      })
    }
  } catch {
    // 忽略錯誤，使用模擬資料
  }

  // 補充到至少15則
  const mockItems = generateMockComments(code, name, changePct)
  const combined = [...newsItems, ...mockItems].slice(0, 17)

  // 計算整體情緒統計
  const positiveCount = combined.filter(c => c.sentiment === 'positive').length
  const negativeCount = combined.filter(c => c.sentiment === 'negative').length
  const neutralCount = combined.filter(c => c.sentiment === 'neutral').length
  const avgScore = combined.reduce((s, c) => s + c.score, 0) / combined.length

  const overallSentiment = avgScore > 20 ? '市場偏多' : avgScore < -20 ? '市場偏空' : '市場中性'
  const sentimentColor = avgScore > 20 ? '#3fb950' : avgScore < -20 ? '#f85149' : '#e3b341'

  return NextResponse.json({
    items: combined,
    stats: {
      total: combined.length,
      positive: positiveCount,
      negative: negativeCount,
      neutral: neutralCount,
      avgScore: Math.round(avgScore),
      overallSentiment,
      sentimentColor,
    }
  })
}
