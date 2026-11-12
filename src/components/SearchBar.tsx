'use client';

import { useState, useCallback } from 'react';

interface Props {
  onSearch: (code: string, market: 'TW' | 'US') => void;
  loading?: boolean;
}

export default function SearchBar({ onSearch, loading = false }: Props) {
  const [code,   setCode]   = useState('');
  const [market, setMarket] = useState<'TW' | 'US'>('TW');

  const handleSubmit = useCallback(() => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed) onSearch(trimmed, market);
  }, [code, market, onSearch]);

  return (
    <div className="flex gap-2 mb-6">
      <select
        value={market}
        onChange={e => setMarket(e.target.value as 'TW' | 'US')}
        className="bg-[#161b22] border border-[#30363d] text-[#e6edf3] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#58a6ff]"
      >
        <option value="TW">台股</option>
        <option value="US">美股</option>
      </select>

      <input
        type="text"
        value={code}
        onChange={e => setCode(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        placeholder={market === 'TW' ? '輸入台股代碼，例如：2330' : '輸入美股代號，例如：AAPL'}
        className="flex-1 bg-[#161b22] border border-[#30363d] text-[#e6edf3] rounded-lg px-4 py-2 outline-none focus:border-[#58a6ff] placeholder:text-[#8b949e]"
      />

      <button
        onClick={handleSubmit}
        disabled={loading || !code.trim()}
        className="bg-[#238636] hover:bg-[#2ea043] disabled:bg-[#30363d] text-white font-bold px-5 py-2 rounded-lg transition-colors"
      >
        {loading ? '查詢中...' : '查詢'}
      </button>
    </div>
  );
}
