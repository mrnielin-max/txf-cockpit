'use client';
import TxfHeader from '@/components/txf/TxfHeader';
import GlobalPulse from '@/components/txf/GlobalPulse';
import { NewsFlow, HistoricalEvents, SessionClock, ChipsDailyPanel } from '@/components/txf/Panels';
import MarketBanner from '@/components/MarketBanner';
import IndexChart from '@/components/IndexChart';
import ContributionPanel from '@/components/ContributionPanel';
import InstitutionsPanel from '@/components/InstitutionsPanel';
import CalendarPanel from '@/components/CalendarPanel';

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
      fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
      fontSize: 15,
    }}>
      {/* ── 頂部導覽列 ── */}
      <nav style={{
        background: '#161b22', borderBottom: '1px solid #21262d',
        padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20,
        height: 60, position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ fontWeight: 800, fontSize: 22, color: '#f97316', letterSpacing: 1, whiteSpace: 'nowrap' }}>
          🎯 台指期駕駛艙
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ color: '#8b949e', fontSize: 13, whiteSpace: 'nowrap' }}>
          對比設計版 · 一切圍繞台指期交易決策
        </div>
      </nav>

      {/* ── 主內容 ── */}
      <div style={{ maxWidth: 1500, margin: '0 auto', padding: '20px 20px' }}>

        {/* 大盤指數橫幅 */}
        <MarketBanner />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>

          {/* ① 台指期本尊：近月報價、基差、委買賣、月合約結構 */}
          <TxfHeader />

          {/* ② 關鍵時段倒數：台股開/收盤、美股開/收盤、結算日 */}
          <SessionClock />

          {/* ③ 海外脈動：TSM ADR、美股期貨、VIX、美債、匯率、日經 */}
          <GlobalPulse />

          {/* ④ 每日籌碼：散戶多空比(小台/微台)、PC OI、月選最大OI、法人淨部位、基差結構 */}
          <ChipsDailyPanel />

          {/* ⑤ 兩欄：大盤分時/貢獻度 + 籌碼/行事曆 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <IndexChart />
              <ContributionPanel />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <InstitutionsPanel />
              <CalendarPanel code="2330" name="台積電" market="TW" />
            </div>
          </div>

          {/* ⑤ 消息面：即時新聞 + 國際因子 + PTT 討論 */}
          <NewsFlow />

          {/* ⑥ 歷史鏡鑑：曾重創/推升台指期的事件庫 */}
          <HistoricalEvents />
        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: '1px solid #21262d', padding: '24px 28px',
        textAlign: 'center', color: '#6b7280', fontSize: 13, marginTop: 40,
      }}>
        <div>台指期駕駛艙 · 資料來源：TAIFEX MIS · 台灣證券交易所 · Yahoo Finance · Google News · PTT</div>
        <div style={{ marginTop: 4 }}>本平台資訊僅供參考，不構成投資建議；期貨交易具高槓桿風險，投資人須自行承擔</div>
      </footer>
    </div>
  );
}
