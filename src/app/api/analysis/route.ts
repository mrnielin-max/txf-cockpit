import { NextRequest, NextResponse } from 'next/server'

function getMacroContext(code: string, market: string, changePct: number, volume: number): string {
  const isTW = market === 'TW' || market === 'TSE' || market === 'OTC'

  // 判斷今日市場環境
  let marketEnv = ''
  if (changePct <= -8) {
    marketEnv = `今日跌幅高達 ${changePct.toFixed(2)}%，接近或觸及跌停板，屬於極度恐慌性賣出。這種幅度通常由重大外部衝擊觸發，例如美國市場隔夜大跌、地緣政治突發事件、或產業鏈重大負面消息。建議投資人不要在恐慌中追殺，需等待市場穩定訊號才能評估後續方向。`
  } else if (changePct <= -4) {
    marketEnv = `今日跌幅 ${changePct.toFixed(2)}%，屬於明顯重挫。結合當前宏觀環境（美聯儲利率政策不確定性、半導體庫存週期調整、美中科技摩擦持續），此波回檔具有系統性風險特徵，並非純粹個股問題。`
  } else if (changePct <= -2) {
    marketEnv = `今日跌幅 ${changePct.toFixed(2)}%，屬於中等幅度修正。在全球股市高估值背景下，這類回調屬於正常去泡沫化過程。目前台灣央行維持謹慎立場，美聯儲降息預期反覆，整體資金環境中性偏緊。`
  } else if (changePct >= 4) {
    marketEnv = `今日大漲 ${changePct.toFixed(2)}%，屬於強勢上攻。台灣 AI 供應鏈持續受惠，加上外資回流亞洲市場，短期資金動能充足。但需留意高點追漲的風險，特別是在指數相對高位時。`
  } else {
    marketEnv = `今日漲跌幅 ${changePct.toFixed(2)}%，屬於盤整格局。市場等待明確方向催化劑，觀望氣氛濃厚。目前宏觀環境下，台灣電子出口動能仍強，但全球需求前景不確定性偏高。`
  }

  // 依股票類型加入產業宏觀判讀
  let sectorMacro = ''
  if (code === '2330') {
    sectorMacro = `台積電作為全球先進製程唯一供應者，其宏觀背景最核心的是：AI 晶片需求（NVIDIA CoWoS 封裝持續旺盛）、蘋果 iPhone 備貨週期、以及美中晶片管制對先進製程的長期保護效應。目前 3nm/2nm 產能供不應求，長期基本面無疑問。`
  } else if (code === '2454') {
    sectorMacro = `聯發科主要受智慧手機 SoC 需求、物聯網滲透率、以及與高通的市佔競爭影響。宏觀背景上，新興市場手機換機潮動能已趨緩，AI 邊緣運算是下一個成長引擎，但變現時程仍有不確定性。`
  } else if (code === '2317') {
    sectorMacro = `鴻海受惠於 AI 伺服器組裝訂單爆發（NVIDIA GB200 機架），但消費電子（iPhone）貢獻比重下降。宏觀上美中供應鏈去風險化對其有雙面影響：墨西哥工廠受惠，中國廠承壓。`
  } else if (code === '2308') {
    sectorMacro = `台達電是 AI 資料中心電源管理的核心受益者，電源供應器與散熱模組需求因 AI 算力爆發而高速成長。宏觀背景：全球資料中心電力消耗激增，台達電的能效解決方案具有長期結構性需求支撐。`
  } else if (code === '0050') {
    sectorMacro = `元大台灣50是台股最佳觀察指標，成分股以台積電為最大權重（約30%以上）。宏觀上台股走勢高度依賴半導體景氣與外資動向，MSCI 季度調整也會帶來資金流向變化。`
  } else if (code === '2303') {
    sectorMacro = `聯電專注成熟製程（28nm以下），主要受工業、車用、消費電子需求驅動。成熟製程全球產能過剩壓力持續，中國廠商大量擴產形成競價壓力，聯電毛利率面臨中長期下行風險。`
  } else if (code === '2382') {
    sectorMacro = `廣達是全球最大筆電代工廠兼 AI 伺服器供應商，Cloud Hyperscaler（AWS、Google、Microsoft）的 AI 基礎設施支出持續增加，廣達的伺服器業務高速成長，已逐步取代筆電成為主要獲利來源。`
  } else if (isTW) {
    sectorMacro = `台灣股市與全球科技供應鏈高度連動，宏觀上受美國 AI 資本支出週期、美聯儲利率政策、新台幣匯率、以及兩岸關係等多重因素影響。`
  } else {
    sectorMacro = `美股市場目前受 AI 投資熱潮、聯準會降息時程預期、及企業獲利成長趨勢主導。高利率環境下，高本益比成長股估值壓力仍在，需關注下季財報指引。`
  }

  return `${marketEnv}\n\n${sectorMacro}`
}

function getTechnicalAnalysis(
  price: number,
  open: number,
  high: number,
  low: number,
  prev: number,
  changePct: number,
  volume: number
): string {
  const shadowRatio = (high - low) / prev * 100
  const upperShadow = (high - Math.max(open, price)) / prev * 100
  const lowerShadow = (Math.min(open, price) - low) / prev * 100
  const bodySize = Math.abs(price - open) / prev * 100

  let candlePattern = ''
  if (lowerShadow > 1.5 && upperShadow < 0.5) {
    candlePattern = `今日K線出現長下影線（下引線 ${lowerShadow.toFixed(1)}%），代表盤中有買盤承接，低點有支撐意願。`
  } else if (upperShadow > 1.5 && lowerShadow < 0.5) {
    candlePattern = `今日K線出現長上影線（上引線 ${upperShadow.toFixed(1)}%），代表高點遭遇賣壓，追高需謹慎。`
  } else if (bodySize < 0.3 && shadowRatio > 2) {
    candlePattern = `今日K線呈現十字星型態，多空力道僵持，市場方向未明，需等待明日確認。`
  } else if (changePct < -3 && bodySize > 2) {
    candlePattern = `今日出現大陰線實體（實體幅度 ${bodySize.toFixed(1)}%），賣壓沉重，短期技術面偏弱，需等收盤確認是否守住關鍵支撐。`
  } else if (changePct > 3 && bodySize > 2) {
    candlePattern = `今日出現大陽線實體（實體幅度 ${bodySize.toFixed(1)}%），買盤積極，短期動能偏多。`
  } else {
    candlePattern = `今日K線屬於一般實體（幅度 ${bodySize.toFixed(1)}%），未出現特殊反轉型態。`
  }

  // 支撐壓力估算
  const support1 = (low * 0.99).toFixed(1)
  const support2 = (low * 0.975).toFixed(1)
  const resist1 = (high * 1.005).toFixed(1)
  const resist2 = (prev * 1.01).toFixed(1)

  const supportResist = `技術支撐位估算：第一支撐 ${support1}（今日低點附近），第二支撐 ${support2}（若跌破前者需再確認）。壓力位：突破 ${resist1} 才有望測試前高 ${resist2}（昨收附近）。`

  // 量能判斷
  let volumeAnalysis = ''
  if (changePct < -3 && volume > 30000) {
    volumeAnalysis = `今日量能放大至 ${volume.toLocaleString()} 張伴隨重挫，屬於「放量急跌」，短期需觀察是否為恐慌底還是趨勢加速下殺。`
  } else if (changePct < 0 && volume < 10000) {
    volumeAnalysis = `今日量能偏低 ${volume.toLocaleString()} 張，縮量下跌，賣壓並不特別沉重，屬於無量回調型態。`
  } else if (changePct > 2 && volume > 20000) {
    volumeAnalysis = `今日量能放大 ${volume.toLocaleString()} 張帶動上漲，屬於「價量齊揚」健康格局。`
  } else {
    volumeAnalysis = `今日成交量 ${volume.toLocaleString()} 張，量能表現正常，未有特殊異常。`
  }

  return `${candlePattern}\n\n${supportResist}\n\n${volumeAnalysis}`
}

function getInvestmentAdvice(code: string, changePct: number, price: number, low: number, high: number): string {
  let advice = ''

  if (changePct <= -9) {
    advice = `【短期：觀望等待】今日接近跌停，不建議追殺，也不建議搶反彈。等待下一個交易日開盤走勢確認，若跌停打開且量能縮小代表賣壓趨緩，才可考慮小量試單。停損設在今日低點 ${low} 以下。`
  } else if (changePct <= -5) {
    advice = `【短期：謹慎觀望】今日大跌超過5%，技術面出現損壞，短線不宜追買。若對長期基本面有信心，可分批布局：先用20%資金在 ${(price * 0.99).toFixed(0)} 附近試單，若繼續跌破則等到 ${(low * 0.98).toFixed(0)} 加碼另外20%，剩餘60%持現金等確認止穩。`
  } else if (changePct <= -2) {
    advice = `【中性偏保守】今日中幅回調，若持有者可繼續持有，暫不追殺。新資金入場建議等回測 ${(low * 1.002).toFixed(0)}-${(price).toFixed(0)} 區間止穩後，再考慮建立初始部位。`
  } else if (changePct >= 5) {
    advice = `【注意追高風險】今日強勢上漲，若已持有可繼續持有並設移動停利。新資金不建議在 ${price} 以上追高，等待回測 ${(low * 1.01).toFixed(0)} 附近再評估進場點。`
  } else {
    advice = `【中性格局】今日走勢平穩，持有者維持原策略。有意布局者可小量在 ${(low).toFixed(0)}-${(price).toFixed(0)} 區間逐步建立部位，以今日低點 ${low} 為停損參考。`
  }

  const disclaimer = `\n\n免責聲明：本分析僅為技術面與市場環境判讀，非投資建議。股市有風險，投資需謹慎，請依自身財務狀況與風險承受度做出決策。`

  return advice + disclaimer
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code') || ''
  const market = searchParams.get('market') || 'TW'
  const price = parseFloat(searchParams.get('price') || '0')
  const open = parseFloat(searchParams.get('open') || '0')
  const high = parseFloat(searchParams.get('high') || '0')
  const low = parseFloat(searchParams.get('low') || '0')
  const prev = parseFloat(searchParams.get('prev') || '0')
  const changePct = parseFloat(searchParams.get('changePct') || '0')
  const volume = parseFloat(searchParams.get('volume') || '0')
  const name = searchParams.get('name') || code

  if (!code || !price) {
    return NextResponse.json({ error: '缺少必要參數' }, { status: 400 })
  }

  const macro = getMacroContext(code, market, changePct, volume)
  const technical = getTechnicalAnalysis(price, open, high, low, prev, changePct, volume)
  const advice = getInvestmentAdvice(code, changePct, price, low, high)

  const now = new Date()
  const timeStr = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })

  return NextResponse.json({
    code,
    name,
    price,
    changePct,
    generatedAt: timeStr,
    macro,
    technical,
    advice,
  })
}
