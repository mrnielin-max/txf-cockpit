// 歷史重大事件庫：曾經顯著影響台指期漲跌的事件
export interface HistEvent {
  date: string;        // ISO date
  title: string;
  category: '崩盤' | '暴漲' | '政策' | '日本' | '美國' | '地緣' | '匯率' | '結構';
  impact: string;      // 台指期/大盤當時反應
  lesson: string;      // 交易啟示
}

export const HIST_EVENTS: HistEvent[] = [
  { date: '2018-02-06', title: '0206 台指期選擇權大屠殺', category: '崩盤',
    impact: '台指期夜盤暴跌、選擇權保證金風控失控，數十萬散戶爆倉，史稱 0206 事件',
    lesson: '極端跳空時選擇權賣方風險無限；事件後期交所修正保證金計價機制' },
  { date: '2020-03-19', title: '新冠崩盤觸底：台指 8,524', category: '崩盤',
    impact: '台指期從 12,100 崩至 8,524（-29%），3/19 盤中熔斷式下跌後 V 型反轉',
    lesson: 'Fed 無限 QE 宣布即底部；流動性危機末期的恐慌低點是最佳多單進場點' },
  { date: '2020-04-20', title: 'WTI 原油負價格 -$37', category: '地緣',
    impact: '全球風險資產劇烈波動，台指期夜盤隨美股期貨震盪',
    lesson: '極端商品價格訊號代表實體需求崩潰，但股市已提前反映' },
  { date: '2021-05-19', title: '台灣三級警戒股災', category: '崩盤',
    impact: '台指期單日重挫近千點，大盤從 17,573 殺至 15,321，當日融資斷頭潮',
    lesson: '本土疫情黑天鵝；本土事件對台股的衝擊通常 2-4 週內收斂' },
  { date: '2022-01-27', title: 'Fed 啟動升息循環', category: '美國',
    impact: '台指期從 18,800 一路下跌至 10 月 12,800（-32%），外資全年賣超 1.5 兆',
    lesson: '美債 10Y 殖利率快速上升 = 成長股/台股殺估值；升息周期做空勝率高' },
  { date: '2022-09-22', title: '日本 24 年來首次干預匯市', category: '日本',
    impact: '日圓急貶至 145，亞洲貨幣競貶，台幣跟貶、外資加速匯出台股',
    lesson: '日圓是亞太資金風向球；日圓急貶期外資賣壓重，台指期承壓' },
  { date: '2023-03-10', title: 'SVB 矽谷銀行倒閉', category: '美國',
    impact: '台指期夜盤急跌，但一週內因 Fed 緊急流動性措施收復',
    lesson: '銀行體系事件初期恐慌常被快速修復，勿追空第二根' },
  { date: '2024-04-19', title: '中東局勢升溫＋ASML 警訊', category: '地緣',
    impact: '台指期單日暴跌 903 點（-4.3%），為當時史上第三大跌點',
    lesson: '以色列伊朗互射 + 半導體設備出口管制雙殺；地緣衝突開盤跳空是常態' },
  { date: '2024-07-11', title: '日銀總裁植田和男鷹派談話', category: '日本',
    impact: '引爆日圓 carry trade 解除，日圓暴升、日經重挫',
    lesson: '日本升息預期升溫 → 日圓升值 → 亞太資金緊縮，台指期連動下跌' },
  { date: '2024-08-05', title: '全球黑色星期一：日經 -12.4%', category: '崩盤',
    impact: '台指期當日暴跌 1,004 點，VIX 飆破 65；日銀 8/7 放軟後一週全數收復',
    lesson: 'Carry trade 崩潰是系統性事件；官方安撫訊號出現即為反轉點' },
  { date: '2025-01-24', title: '日銀升息至 0.5%（30年新高）', category: '日本',
    impact: '日圓升值、亞太股市短線震盪，台指期承壓後隨 AI 題材回穩',
    lesson: '日本升息已被市場部分定價；重點在升息「節奏」而非單次行動' },
  { date: '2025-04-07', title: '川普對等關稅：台指史上最大跌點', category: '美國',
    impact: '台指期开盘跌停級暴跌 2,065 點（-9.7%）創史上最大單日跌點，隨後三日反彈 2,000 點',
    lesson: '政策黑天鵝第一天不接刀；川普關稅模式 = 極限施壓後談判，V型反轉機率高' },
  { date: '2025-04-09', title: '關稅暫停 90 天宣布', category: '美國',
    impact: '美股期貨觸及漲停，台指期夜盤暴拉，隔日現貨大漲',
    lesson: '美股期貨漲停/跌停是台指期開盤方向的最強訊號' },
  { date: '2026-01-15', title: '台積電法說＋AI 資本支出超級循環', category: '結構',
    impact: '台指站上 40,000 大關，台積電市值佔比近半，指數與 TSM 高度連動',
    lesson: '當前台指期本質上是「台積電期貨」；TSM ADR 隔夜表現 = 隔日台指期開盤預測器' },
];

// 每月固定事件：台指期結算日（每月第三個星期三）
export function thirdWednesday(year: number, month: number): Date {
  const d = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  while (count < 3) {
    if (d.getUTCDay() === 3) count++;
    if (count < 3) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}
