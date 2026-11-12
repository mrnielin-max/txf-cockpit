'use client';

import { WatchlistItem, StockQuote } from '@/types/stock';
import { useState, useEffect, useCallback } from 'react';

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { code: '2330', name: '台積電', market: 'TSE' },
  { code: '2454', name: '聯發科', market: 'TSE' },
  { code: '2317', name: '鴻海',   market: 'TSE' },
  { code: '2308', name: '台達電', market: 'TSE' },
  { code: 'AAPL', name: 'Apple',  market: 'US'  },
  { code: 'NVDA', name: 'NVIDIA', market: 'US'  },
  { code: 'TSLA', name: 'Tesla',  market: 'US'  },
  { code: 'MSFT', name: 'Microsoft', market: 'US' },
];

const STORAGE_KEY = 'stock_watchlist';

interface Props {
  onSelect: (code: string, market: 'TW' | 'US') => void;
}

export default function Watchlist({ onSelect }: Props) {
  const [list, setList]               = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes]           = useState<Record<string, StockQuote>>({});
  const [loading, setLoading]         = useState<Record<string, boolean>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [tab, setTab]                 = useState<'ALL' | 'TW' | 'US'>('ALL');
  const [addCode, setAddCode]         = useState('');
  const [addMarket, setAddMarket]     = useState<'TW' | 'US'>('TW');
  const [adding, setAdding]           = useState(false);
  const [addError, setAddError]       = useState('');
  const [showAdd, setShowAdd]         = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [editMode, setEditMode]       = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setList(saved ? JSON.parse(saved) : DEFAULT_WATCHLIST);
    } catch {
      setList(DEFAULT_WATCHLIST);
    }
  }, []);

  const saveList = (newList: WatchlistItem[]) => {
    setList(newList);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newList)); } catch {}
  };

  const fetchQuotes = useCallback(async (items: WatchlistItem[], silent = false) => {
    if (!silent) setRefreshing(true);
    const loadingMap: Record<string, boolean> = {};
    items.forEach(i => { loadingMap[i.code] = true; });
    if (!silent) setLoading(loadingMap);

    await Promise.all(items.map(async (item) => {
      try {
        const market = item.market === 'US' ? 'US' : 'TW';
        const res = await fetch(`/api/quote?code=${item.code}&market=${market}`);
        if (!res.ok) return;
        const q: StockQuote = await res.json();
        setQuotes(prev => ({ ...prev, [item.code]: q }));
      } catch {}
      setLoading(prev => ({ ...prev, [item.code]: false }));
    }));

    const now = new Date();
    setLastUpdated(now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (list.length === 0) return;
    fetchQuotes(list);
    const interval = setInterval(() => fetchQuotes(list, true), 30_000);
    return () => clearInterval(interval);
  }, [list, fetchQuotes]);

  const handleAdd = async () => {
    const code = addCode.trim().toUpperCase();
    if (!code) return;
    if (list.find(i => i.code === code)) {
      setAddError('此股票已在自選清單中'); return;
    }
    setAdding(true); setAddError('');
    try {
      const res = await fetch(`/api/quote?code=${code}&market=${addMarket}`);
      if (!res.ok) { setAddError('找不到此股票代碼，請確認後再試'); setAdding(false); return; }
      const q: StockQuote = await res.json();
      const newItem: WatchlistItem = { code: q.code, name: q.name, market: addMarket === 'US' ? 'US' : 'TSE' };
      saveList([...list, newItem]);
      setQuotes(prev => ({ ...prev, [q.code]: q }));
      setAddCode(''); setShowAdd(false);
    } catch {
      setAddError('查詢失敗，請稍後再試');
    }
    setAdding(false);
  };

  const handleDelete = (code: string) => {
    saveList(list.filter(i => i.code !== code));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const realIdx = list.indexOf(filteredList[idx]);
    const newList = [...list];
    [newList[realIdx - 1], newList[realIdx]] = [newList[realIdx], newList[realIdx - 1]];
    saveList(newList);
  };

  const moveDown = (idx: number) => {
    if (idx === filteredList.length - 1) return;
    const realIdx = list.indexOf(filteredList[idx]);
    const newList = [...list];
    [newList[realIdx + 1], newList[realIdx]] = [newList[realIdx], newList[realIdx + 1]];
    saveList(newList);
  };

  const filteredList = list.filter(i => {
    if (tab === 'TW') return i.market !== 'US';
    if (tab === 'US') return i.market === 'US';
    return true;
  });

  const twCount = list.filter(i => i.market !== 'US').length;
  const usCount = list.filter(i => i.market === 'US').length;

  return (
    <div className="mb-8">
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        {/* 第一行：標題 + 更新時間 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#e6edf3', margin: 0, whiteSpace: 'nowrap' }}>⭐ 自選股</h2>
          {lastUpdated && (
            <span style={{ fontSize: 13, color: '#8b949e', whiteSpace: 'nowrap' }}>更新 {lastUpdated}</span>
          )}
        </div>
        {/* 第二行：操作按鈕 */}
        <div className="flex items-center gap-2">
          {!editMode && (
            <button
              onClick={() => fetchQuotes(list)}
              disabled={refreshing}
              className="text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors px-2 py-1 rounded border border-[#30363d] hover:border-[#58a6ff]"
            >
              {refreshing ? '更新中...' : '🔄 刷新'}
            </button>
          )}
          <button
            onClick={() => { setEditMode(v => !v); setShowAdd(false); }}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              editMode
                ? 'bg-[#3fb950] text-white hover:bg-[#2ea043]'
                : 'bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3] border border-[#30363d]'
            }`}
          >
            {editMode ? '✓ 完成編輯' : '✏️ 編輯'}
          </button>
          {!editMode && (
            <button
              onClick={() => { setShowAdd(v => !v); setAddError(''); }}
              className="text-xs bg-[#1f6feb] hover:bg-[#388bfd] text-white px-3 py-1 rounded transition-colors"
            >
              {showAdd ? '✕ 取消' : '＋ 新增'}
            </button>
          )}
        </div>
      </div>

      {/* 新增表單 */}
      {showAdd && !editMode && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4 mb-4">
          <div className="flex gap-2 flex-wrap">
            <select
              value={addMarket}
              onChange={e => setAddMarket(e.target.value as 'TW' | 'US')}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2"
            >
              <option value="TW">台股</option>
              <option value="US">美股</option>
            </select>
            <input
              type="text"
              value={addCode}
              onChange={e => { setAddCode(e.target.value); setAddError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder={addMarket === 'TW' ? '輸入代碼 例：0050' : '輸入代碼 例：GOOG'}
              className="flex-1 bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] min-w-[160px]"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addCode.trim()}
              className="bg-[#1f6feb] hover:bg-[#388bfd] disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {adding ? '查詢中...' : '新增'}
            </button>
          </div>
          {addError && <p className="text-[#f85149] text-xs mt-2">{addError}</p>}
        </div>
      )}

      {/* 分類 Tab */}
      <div className="flex gap-1 mb-3">
        {[
          { key: 'ALL', label: `全部 (${list.length})` },
          { key: 'TW',  label: `台股 (${twCount})` },
          { key: 'US',  label: `美股 (${usCount})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
              tab === t.key
                ? 'bg-[#1f6feb] text-white'
                : 'bg-[#161b22] text-[#8b949e] hover:text-[#e6edf3] border border-[#30363d]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 編輯模式：清單排序 */}
      {editMode ? (
        <div className="space-y-2">
          {filteredList.length === 0 ? (
            <div className="text-center text-[#8b949e] text-sm py-8 bg-[#161b22] rounded-xl border border-[#30363d]">
              尚無自選股
            </div>
          ) : (
            filteredList.map((item, idx) => (
              <div
                key={item.code}
                className="flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-2"
              >
                {/* 上下移動 */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    className="text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-20 text-xs leading-none px-1"
                    title="上移"
                  >▲</button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === filteredList.length - 1}
                    className="text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-20 text-xs leading-none px-1"
                    title="下移"
                  >▼</button>
                </div>

                {/* 股票資訊 */}
                <div className="flex-1 min-w-0">
                  <span className="text-[#58a6ff] font-bold text-sm">{item.code}</span>
                  <span className="text-[#8b949e] text-xs ml-2">{item.name}</span>
                </div>

                {/* 市場標籤 */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium text-white flex-shrink-0 ${
                  item.market === 'US' ? 'bg-purple-700' : 'bg-[#1f6feb]'
                }`}>
                  {item.market === 'US' ? '美股' : '台股'}
                </span>

                {/* 移除按鈕 */}
                <button
                  onClick={() => handleDelete(item.code)}
                  className="flex-shrink-0 text-[#f85149] hover:bg-[#f85149]/10 text-sm w-7 h-7 flex items-center justify-center rounded transition-colors"
                  title="移除"
                >✕</button>
              </div>
            ))
          )}
          {/* 重置按鈕 */}
          <div className="mt-3 text-right">
            <button
              onClick={() => { saveList(DEFAULT_WATCHLIST); setQuotes({}); }}
              className="text-xs text-[#484f58] hover:text-[#8b949e] transition-colors"
            >
              重置為預設清單
            </button>
          </div>
        </div>
      ) : (
        /* 一般顯示：股票卡片 */
        <>
          {filteredList.length === 0 ? (
            <div className="text-center text-[#8b949e] text-sm py-8 bg-[#161b22] rounded-xl border border-[#30363d]">
              尚無自選股，點選「＋ 新增」加入
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredList.map(item => {
                const q = quotes[item.code];
                const isLoading = loading[item.code];
                const isUp = q ? q.change >= 0 : null;
                const priceColor = isUp === null ? 'text-[#8b949e]' : isUp ? 'text-[#3fb950]' : 'text-[#f85149]';

                return (
                  <div
                    key={item.code}
                    className="relative bg-[#161b22] border border-[#30363d] rounded-xl p-3 transition-all duration-200 hover:border-[#58a6ff]/40"
                  >
                    {/* 頂部列 */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[#58a6ff] font-bold text-sm leading-none">{item.code}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium text-white ${item.market === 'US' ? 'bg-purple-700' : 'bg-[#1f6feb]'}`}>
                        {item.market === 'US' ? '美股' : '台股'}
                      </span>
                    </div>

                    {/* 股票名稱 */}
                    <div className="text-[#8b949e] text-xs mb-2 truncate">{item.name || q?.name || ''}</div>

                    {/* 點擊進入詳情 */}
                    <button
                      onClick={() => onSelect(item.code, item.market === 'US' ? 'US' : 'TW')}
                      className="w-full text-left"
                    >
                      {isLoading && !q && (
                        <div className="text-[#8b949e] text-xs">載入中...</div>
                      )}

                      {q && (
                        <>
                          <div className={`text-xl font-bold ${priceColor}`}>
                            {q.price.toFixed(q.market === 'US' ? 2 : 1)}
                          </div>
                          <div className={`text-xs mt-0.5 ${priceColor}`}>
                            {isUp ? '▲' : '▼'} {Math.abs(q.change).toFixed(q.market === 'US' ? 2 : 1)}
                            {' '}({isUp ? '+' : ''}{q.changePct.toFixed(2)}%)
                          </div>
                          <div className="mt-2 pt-2 border-t border-[#30363d] grid grid-cols-2 gap-x-2 gap-y-1">
                            <div>
                              <div className="text-[#484f58] text-[10px]">開盤</div>
                              <div className="text-[#8b949e] text-xs">{q.open.toFixed(q.market === 'US' ? 2 : 1)}</div>
                            </div>
                            <div>
                              <div className="text-[#484f58] text-[10px]">昨收</div>
                              <div className="text-[#8b949e] text-xs">{q.prev.toFixed(q.market === 'US' ? 2 : 1)}</div>
                            </div>
                            <div>
                              <div className="text-[#484f58] text-[10px]">最高</div>
                              <div className="text-[#3fb950] text-xs">{q.high.toFixed(q.market === 'US' ? 2 : 1)}</div>
                            </div>
                            <div>
                              <div className="text-[#484f58] text-[10px]">最低</div>
                              <div className="text-[#f85149] text-xs">{q.low.toFixed(q.market === 'US' ? 2 : 1)}</div>
                            </div>
                          </div>
                          {q.volume > 0 && (
                            <div className="mt-1.5 text-[10px] text-[#484f58]">
                              量 {q.volume > 10000 ? (q.volume / 10000).toFixed(1) + '萬張' : q.volume.toLocaleString() + '張'}
                            </div>
                          )}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
