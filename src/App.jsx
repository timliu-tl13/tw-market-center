import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Radar, CalendarRange, Building2, Layers,
  TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, Flame,
  Search, SlidersHorizontal, RefreshCw, ArrowUpRight, ArrowDownRight,
  CheckCircle2, Sparkles, BarChart3, Activity
} from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  ZAxis, Tooltip, ReferenceLine, Cell, BarChart, Bar
} from 'recharts';

const fmtNum = (n, d = 2) => (n === null || n === undefined || Number.isNaN(Number(n))) ? '-' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n) => (n === null || n === undefined || Number.isNaN(Number(n))) ? '-' : Math.round(Number(n)).toLocaleString('zh-TW');
const pctColor = (v) => (Number(v) > 0 ? 'text-rose-400' : Number(v) < 0 ? 'text-emerald-400' : 'text-slate-300');
const pctSign = (v) => (Number(v) > 0 ? `+${fmtNum(v)}%` : `${fmtNum(v)}%`);

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');

  // v7 可調參數門檻
  const [dispThresh, setDispThresh] = useState(20);
  const [dtThresh, setDtThresh] = useState(40);
  const [marginThresh, setMarginThresh] = useState(25);
  const [itMinAmt, setItMinAmt] = useState(20000);
  const [showAll15, setShowAll15] = useState(true);
  const [showParams, setShowParams] = useState(false);

  // 月漲幅過濾
  const [monthLiqOnly, setMonthLiqOnly] = useState(true);

  // 細產業篩選
  const [sectorGroup, setSectorGroup] = useState('ALL');
  const [sectorSort, setSectorSort] = useState('d');

  useEffect(() => {
    fetch('/market_dashboard_data.json?t=' + Date.now())
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // 動態重算 v7 指標
  const evaluatedV7 = useMemo(() => {
    if (!data?.v7_stocks) return [];
    return data.v7_stocks.map((s) => {
      const sd = s.d1 > dispThresh && s.dd > 10 ? 1 : 0;
      const sdt = s.dt1 > dtThresh && (s.dt1 - (s.dt5 || 0)) > 10 ? 1 : 0;
      const sm = s.m1 > marginThresh && (s.m1 - (s.m5 || 0)) > 3 ? 1 : 0;
      const smf = s.smf || (s.mf1 < -5 && s.mf5 < -3 ? 1 : 0);
      const sit = s.it5_amt < -itMinAmt ? 1 : 0;
      const bs = sd + sdt + sm + smf + sit;
      const sg = s.mf5 > 5 && s.d1 < -15 && s.dd < -10 && s.dt1 >= 15 && s.dt1 <= dtThresh ? 1 : 0;
      const sit_buy = s.it5_amt >= itMinAmt && (s.sit_buy === 1 || s.sms === 1) ? 1 : (s.it5_amt >= itMinAmt ? 1 : 0);
      return { ...s, sd, sdt, sm, smf, sit, bs, sg, sit_buy };
    });
  }, [data, dispThresh, dtThresh, marginThresh, itMinAmt]);

  const v7Stats = useMemo(() => {
    const wavePrime = evaluatedV7.filter((s) => (s.sg === 1 || s.sit_buy === 1) && s.sms === 1);
    const itAdopt = evaluatedV7.filter((s) => s.sit_buy === 1);
    const mfFocus = evaluatedV7.filter((s) => s.sg === 1);
    const blackKPrime = evaluatedV7.filter((s) => s.bs >= 2 && s.chg >= -2);
    const blackKSub = evaluatedV7.filter((s) => s.chg >= 3 && s.bs >= 1);
    const dispList = evaluatedV7.filter((s) => s.sd === 1).sort((a, b) => b.d1 - a.d1);
    const dtHotList = evaluatedV7.filter((s) => s.sdt === 1).sort((a, b) => b.dt1 - a.dt1);
    const retailList = evaluatedV7.filter((s) => s.sm === 1).sort((a, b) => b.m1 - a.m1);

    const goodSorted = [...evaluatedV7].sort((a, b) => {
      const tierA = (a.sg && a.sms ? 4 : a.sg ? 3 : a.sit_buy ? 2 : a.sms ? 1 : 0);
      const tierB = (b.sg && b.sms ? 4 : b.sg ? 3 : b.sit_buy ? 2 : b.sms ? 1 : 0);
      if (tierB !== tierA) return tierB - tierA;
      return b.sc - a.sc;
    });

    const badSorted = [...evaluatedV7].sort((a, b) => {
      if (b.bs !== a.bs) return b.bs - a.bs;
      return a.sc - b.sc;
    });

    return {
      wavePrime, itAdopt, mfFocus, blackKPrime, blackKSub,
      dispList, dtHotList, retailList,
      topGood: showAll15 ? goodSorted.slice(0, 15) : goodSorted.filter((s) => s.sg === 1 || s.sit_buy === 1).slice(0, 15),
      topBad: badSorted.slice(0, 15)
    };
  }, [evaluatedV7, showAll15]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center text-slate-300">
        <div className="flex items-center gap-3 text-lg font-medium">
          <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
          正在載入台股多空戰情數據...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0B0F19] flex items-center justify-center text-rose-400">
        無法讀取 market_dashboard_data.json，請確認檔案已上傳至 public 資料夾。
      </div>
    );
  }

  const ms = data.market_summary || {};
  const q = searchQuery.trim().toLowerCase();
  const filterStock = (arr) => !q ? arr : arr.filter((s) => String(s.c).toLowerCase().includes(q) || String(s.n).toLowerCase().includes(q));

  const tabs = [
    { id: 'home', label: '首頁大盤總覽', icon: LayoutDashboard },
    { id: 'v7', label: '飆股篩選 v7 籌碼', icon: Radar },
    { id: 'month', label: '當月漲跌幅排行', icon: CalendarRange },
    { id: 'inst', label: '法人買賣超 ＆ 投信', icon: Building2 },
    { id: 'sector', label: '細產業 ＆ 技術突破', icon: Layers }
  ];

  const sortedSectors = [...(data.sectors || [])]
    .filter((s) => sectorGroup === 'ALL' || s.g === sectorGroup)
    .filter((s) => !q || s.n.toLowerCase().includes(q))
    .sort((a, b) => (b[sectorSort] ?? -999) - (a[sectorSort] ?? -999));

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 pb-16">
      {/* 頂部導覽列 */}
      <header className="sticky top-0 z-30 bg-[#0B0F19]/95 backdrop-blur border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/30 flex items-center justify-center">
              <Activity className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                台股多空戰情指揮中心
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  雲端自動同步
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                資料基準日：<span className="text-slate-200 font-medium">{data.trade_date}</span> ｜ 系統更新：{data.updated_at}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋代號、股名或產業..."
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* 五大子主題導覽頁籤 */}
        <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto gap-1 no-scrollbar border-t border-slate-800/50">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  active
                    ? 'border-rose-500 text-white bg-slate-900/60'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-rose-400' : 'text-slate-500'}`} />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pt-6 space-y-6">
        {/* =================================================================
            TAB 1: 首頁大盤戰情總覽
           ================================================================= */}
        {activeTab === 'home' && (
          <>
            {/* 大盤核心指標 4 卡片 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 加權指數 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                  <span>加權指數 (TAIEX)</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">集中市場</span>
                </div>
                <div className={`text-2xl font-bold font-mono ${pctColor(ms.twse_chg)}`}>
                  {fmtNum(ms.twse_index, 2)}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={`font-mono font-semibold ${pctColor(ms.twse_chg)}`}>
                    {ms.twse_pts > 0 ? '▲' : '▼'} {fmtNum(Math.abs(ms.twse_pts), 2)} ({pctSign(ms.twse_chg)})
                  </span>
                  <span className="text-slate-400">成交 <strong className="text-slate-200">{fmtNum(ms.twse_amt, 1)}</strong> 億</span>
                </div>
              </div>

              {/* 櫃買指數 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                  <span>櫃買指數 (TPEx)</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">中小型股</span>
                </div>
                <div className={`text-2xl font-bold font-mono ${pctColor(ms.tpex_chg)}`}>
                  {fmtNum(ms.tpex_index, 2)}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={`font-mono font-semibold ${pctColor(ms.tpex_chg)}`}>
                    {ms.tpex_pts > 0 ? '▲' : '▼'} {fmtNum(Math.abs(ms.tpex_pts), 2)} ({pctSign(ms.tpex_chg)})
                  </span>
                  <span className="text-slate-400">成交 <strong className="text-slate-200">{fmtNum(ms.tpex_amt, 1)}</strong> 億</span>
                </div>
              </div>

              {/* 三大法人買賣超 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                  <span>三大法人合計買賣超</span>
                  <span className="text-slate-500">單位：億元</span>
                </div>
                <div className={`text-2xl font-bold font-mono ${pctColor(ms.inst_total)}`}>
                  {ms.inst_total > 0 ? `+${fmtNum(ms.inst_total, 2)}` : fmtNum(ms.inst_total, 2)} 億
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] pt-1 border-t border-slate-800/80">
                  <div>外資 <span className={`font-mono font-semibold ${pctColor(ms.foreign_net)}`}>{ms.foreign_net > 0 ? '+' : ''}{fmtNum(ms.foreign_net, 1)}</span></div>
                  <div>投信 <span className={`font-mono font-semibold ${pctColor(ms.trust_net)}`}>{ms.trust_net > 0 ? '+' : ''}{fmtNum(ms.trust_net, 1)}</span></div>
                  <div>自營 <span className={`font-mono font-semibold ${pctColor(ms.dealer_net)}`}>{ms.dealer_net > 0 ? '+' : ''}{fmtNum(ms.dealer_net, 1)}</span></div>
                </div>
              </div>

              {/* 融資餘額與增減 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center text-xs text-slate-400 mb-1">
                  <span>大盤融資餘額 ＆ 增減</span>
                  <span className="text-slate-500">散戶槓桿</span>
                </div>
                <div className="text-2xl font-bold font-mono text-amber-300">
                  {fmtNum(ms.margin_bal, 1)} 億
                </div>
                <div className="mt-2 flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                  <span>今日增減：<strong className={`font-mono ${pctColor(ms.margin_chg)}`}>{ms.margin_chg > 0 ? `+${fmtNum(ms.margin_chg, 1)}` : fmtNum(ms.margin_chg, 1)} 億</strong></span>
                  <span className="text-slate-400">融券 {fmtNum(ms.short_bal, 1)} 萬張</span>
                </div>
              </div>
            </div>

            {/* 全市場多空結構廣度 & 五大策略即時雷達 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 左側：全市場紅黑K與均線結構 */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-5">
                <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-sky-400" /> 全市場多空與均線結構
                </h2>
                <div className="space-y-3">
                  {(ms.breadth || []).filter((b) => b.name !== '個股總數').map((b) => {
                    const isBull = b.name.includes('紅K') || b.name.includes('上漲') || b.name.includes('突破');
                    return (
                      <div key={b.name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">{b.name}</span>
                          <span className="font-mono text-slate-200">{fmtInt(b.count)} 檔 ({fmtNum(b.pct, 2)}%)</span>
                        </div>
                        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isBull ? 'bg-rose-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, Math.max(2, b.pct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 右側：五大策略訊號總表（點擊直達分頁） */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" /> 五大策略雷達即時統計（點擊前往明細）
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 hover:border-rose-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-rose-300">★ 波段首選（雙引擎轉佳＋資減）</span>
                      <span className="text-xl font-bold font-mono text-rose-400">{v7Stats.wavePrime.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">主力與投信同步偏多且融資沉澱站穩月線</p>
                  </button>

                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 hover:border-amber-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-amber-300">🏦 投信真金認養（連買＋守成本）</span>
                      <span className="text-xl font-bold font-mono text-amber-400">{v7Stats.itAdopt.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">5日投信買超 &gt; {fmtInt(itMinAmt)} 千元且守穩成本</p>
                  </button>

                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 hover:border-emerald-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-emerald-300">⚡ 日內打黑K觀察（高檔過熱）</span>
                      <span className="text-xl font-bold font-mono text-emerald-400">{v7Stats.blackKPrime.length + v7Stats.blackKSub.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">籌碼發散、當沖過熱或逆勢大漲轉弱警戒</p>
                  </button>

                  <button onClick={() => setActiveTab('sector')} className="text-left p-3.5 rounded-xl bg-sky-950/30 border border-sky-500/30 hover:border-sky-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-sky-300">🏆 帶量突破 ＆ 強勢細產業</span>
                      <span className="text-xl font-bold font-mono text-sky-400">{(data.sd_breakout || []).length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">追蹤 107 個細產業輪動與帶量突破均線標的</p>
                  </button>
                </div>
              </div>
            </div>

            {/* 首頁精選快覽：波段首選 & 外資投信買超前五 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-rose-300">★ 今日波段首選 ＆ 投信/主力轉佳清單</h3>
                  <button onClick={() => setActiveTab('v7')} className="text-xs text-sky-400 hover:underline">查看完整 v7 雷達 →</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">代號/名稱</th>
                        <th className="py-2 text-right">收盤</th>
                        <th className="py-2 text-right">漲幅</th>
                        <th className="py-2 text-right">5日主力%</th>
                        <th className="py-2 text-right">5日投信(萬)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {v7Stats.topGood.slice(0, 8).map((s) => (
                        <tr key={s.c} className="hover:bg-slate-800/40">
                          <td className="py-2 font-medium text-slate-200">{s.c} {s.n}</td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.p)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.chg)}`}>{pctSign(s.chg)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.mf5)}`}>{pctSign(s.mf5)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.it5_amt)}`}>{fmtInt(s.it5_amt / 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-amber-300">🔥 強勢細產業類股 TOP 8（今日漲幅）</h3>
                  <button onClick={() => setActiveTab('sector')} className="text-xs text-sky-400 hover:underline">查看全部 107 類股 →</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">族群</th>
                        <th className="py-2 text-left">細產業名稱</th>
                        <th className="py-2 text-right">日報酬</th>
                        <th className="py-2 text-right">週報酬</th>
                        <th className="py-2 text-right">月報酬</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {[...(data.sectors || [])].sort((a, b) => b.d - a.d).slice(0, 8).map((sec, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2 text-slate-400">{sec.g}</td>
                          <td className="py-2 font-medium text-slate-200">{sec.n}</td>
                          <td className={`py-2 text-right font-mono font-semibold ${pctColor(sec.d)}`}>{pctSign(sec.d)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(sec.w)}`}>{pctSign(sec.w)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(sec.m)}`}>{sec.m !== null ? pctSign(sec.m) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* =================================================================
            TAB 2: 飆股篩選 v7 雙向籌碼雷達
           ================================================================= */}
        {activeTab === 'v7' && (
          <>
            {/* 可調參數列 */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    籌碼發散(空)：<strong>{v7Stats.dispList.length} 檔</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    當沖過熱(空)：<strong>{v7Stats.dtHotList.length} 檔</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30">
                    散戶追價(空)：<strong>{v7Stats.retailList.length === 0 ? '0 檔（當日無觸發）' : `${v7Stats.retailList.length} 檔`}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAll15(!showAll15)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  >
                    {showAll15 ? '目前：補足顯示 Top 15' : '目前：僅看嚴格達標股'}
                  </button>
                  <button
                    onClick={() => setShowParams(!showParams)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" /> 參數門檻設定
                  </button>
                </div>
              </div>

              {showParams && (
                <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">籌碼發散門檻：{dispThresh}%</label>
                    <input type="range" min="10" max="50" value={dispThresh} onChange={(e) => setDispThresh(Number(e.target.value))} className="w-full accent-rose-500" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">當沖過熱門檻：{dtThresh}%</label>
                    <input type="range" min="25" max="70" value={dtThresh} onChange={(e) => setDtThresh(Number(e.target.value))} className="w-full accent-amber-500" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">融資使用率追價門檻：{marginThresh}%</label>
                    <input type="range" min="10" max="50" value={marginThresh} onChange={(e) => setMarginThresh(Number(e.target.value))} className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">5日投信買超門檻：{fmtInt(itMinAmt)} 千</label>
                    <input type="range" min="5000" max="100000" step="5000" value={itMinAmt} onChange={(e) => setItMinAmt(Number(e.target.value))} className="w-full accent-sky-500" />
                  </div>
                </div>
              )}
            </div>

            {/* 籌碼變好 Top 15 vs 籌碼變差 Top 15 雙榜 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 多方 Top 15 */}
              <div className="bg-slate-900/90 border border-rose-500/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> 籌碼變好最多 TOP {v7Stats.topGood.length}（多方動能）
                  </h2>
                  <span className="text-[11px] text-slate-400">主力吸籌＋投信認養＋資減</span>
                </div>
                {v7Stats.topGood.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">當日無符合條件之多方標的</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800">
                          <th className="py-2 text-left">個股</th>
                          <th className="py-2 text-right">收盤/漲幅</th>
                          <th className="py-2 text-right">1日分散</th>
                          <th className="py-2 text-right">5日主力%</th>
                          <th className="py-2 text-right">5日投信(千)</th>
                          <th className="py-2 text-left pl-2">實戰判讀</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filterStock(v7Stats.topGood).map((s) => (
                          <tr key={s.c} className="hover:bg-slate-800/40">
                            <td className="py-2 font-medium text-slate-200 whitespace-nowrap">{s.c} {s.n}</td>
                            <td className="py-2 text-right font-mono whitespace-nowrap">
                              {fmtNum(s.p)} <span className={pctColor(s.chg)}>({pctSign(s.chg)})</span>
                            </td>
                            <td className="py-2 text-right font-mono text-rose-300">{fmtNum(s.d1, 1)}%</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.mf5)}`}>{pctSign(s.mf5)}</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.it5_amt)}`}>{fmtInt(s.it5_amt)}</td>
                            <td className="py-2 pl-2 text-[11px] text-amber-300 truncate max-w-[140px]" title={s.adv}>{s.adv.split('：')[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 空方 Top 15 */}
              <div className="bg-slate-900/90 border border-emerald-500/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" /> 籌碼變差最多 TOP {v7Stats.topBad.length}（空方警戒）
                  </h2>
                  <span className="text-[11px] text-slate-400">發散＋過熱＋主力/投信倒貨</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">個股</th>
                        <th className="py-2 text-right">收盤/漲幅</th>
                        <th className="py-2 text-center">惡化分</th>
                        <th className="py-2 text-right">1日分散</th>
                        <th className="py-2 text-right">5日主力%</th>
                        <th className="py-2 text-left pl-2">觸發警訊</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filterStock(v7Stats.topBad).map((s) => (
                        <tr key={s.c} className="hover:bg-slate-800/40">
                          <td className="py-2 font-medium text-slate-200 whitespace-nowrap">{s.c} {s.n}</td>
                          <td className="py-2 text-right font-mono whitespace-nowrap">
                            {fmtNum(s.p)} <span className={pctColor(s.chg)}>({pctSign(s.chg)})</span>
                          </td>
                          <td className="py-2 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">{s.bs}分</span>
                          </td>
                          <td className="py-2 text-right font-mono text-emerald-300">{fmtNum(s.d1, 1)}%</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.mf5)}`}>{pctSign(s.mf5)}</td>
                          <td className="py-2 pl-2 flex flex-wrap gap-1">
                            {s.sd === 1 && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px]">發散</span>}
                            {s.sdt === 1 && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">當沖熱</span>}
                            {s.smf === 1 && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">主力倒</span>}
                            {s.sit === 1 && <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px]">投信賣</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 三大警訊專區：籌碼發散 / 當沖過熱 / 散戶追價 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 籌碼發散 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-300 mb-2">🚨 籌碼發散明細（買家數 &gt; 賣家數）</h3>
                {v7Stats.dispList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">當日無觸發籌碼發散之個股</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-1.5 text-left">個股</th>
                          <th className="py-1.5 text-right">家數差</th>
                          <th className="py-1.5 text-right">1日分散</th>
                          <th className="py-1.5 text-right">較5日增</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {filterStock(v7Stats.dispList).slice(0, 20).map((s) => (
                          <tr key={s.c}>
                            <td className="py-1.5 text-slate-200">{s.c} {s.n}</td>
                            <td className="py-1.5 text-right font-mono text-rose-300">+{s.bd}</td>
                            <td className="py-1.5 text-right font-mono">{fmtNum(s.d1, 1)}%</td>
                            <td className="py-1.5 text-right font-mono text-amber-300">+{fmtNum(s.dd, 1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 當沖過熱 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-300 mb-2">🔥 當沖過熱明細（當沖比 &gt; {dtThresh}%）</h3>
                {v7Stats.dtHotList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">當日無觸發當沖過熱之個股</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-1.5 text-left">個股</th>
                          <th className="py-1.5 text-right">漲幅</th>
                          <th className="py-1.5 text-right">今日當沖</th>
                          <th className="py-1.5 text-right">5日均沖</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {filterStock(v7Stats.dtHotList).slice(0, 20).map((s) => (
                          <tr key={s.c}>
                            <td className="py-1.5 text-slate-200">{s.c} {s.n}</td>
                            <td className={`py-1.5 text-right font-mono ${pctColor(s.chg)}`}>{pctSign(s.chg)}</td>
                            <td className="py-1.5 text-right font-mono text-amber-300 font-semibold">{fmtNum(s.dt1, 1)}%</td>
                            <td className="py-1.5 text-right font-mono text-slate-400">{fmtNum(s.dt5, 1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 散戶追價 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-purple-300 mb-2">💳 散戶追價明細（融資使用率激增）</h3>
                {v7Stats.retailList.length === 0 ? (
                  <div className="py-8 text-center">
                    <span className="inline-block px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs mb-2">
                      當日無觸發（0 檔）
                    </span>
                    <p className="text-xs text-slate-500">全市場無個股同時符合融資使用率 &gt; {marginThresh}% 且較 5 日激增 &gt; 3%</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-1.5 text-left">個股</th>
                          <th className="py-1.5 text-right">使用率</th>
                          <th className="py-1.5 text-right">5日均</th>
                          <th className="py-1.5 text-right">資增減</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {filterStock(v7Stats.retailList).map((s) => (
                          <tr key={s.c}>
                            <td className="py-1.5 text-slate-200">{s.c} {s.n}</td>
                            <td className="py-1.5 text-right font-mono text-purple-300">{fmtNum(s.m1, 1)}%</td>
                            <td className="py-1.5 text-right font-mono text-slate-400">{fmtNum(s.m5, 1)}%</td>
                            <td className="py-1.5 text-right font-mono">{fmtInt(s.mc)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* =================================================================
            TAB 3: 當月漲跌幅排行（月漲幅 v2）
           ================================================================= */}
        {activeTab === 'month' && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">當月個股漲跌幅強弱勢排行</h2>
                <p className="text-xs text-slate-400">追蹤單月動能延續性與連續三月波段表現</p>
              </div>
              <button
                onClick={() => setMonthLiqOnly(!monthLiqOnly)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  monthLiqOnly ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {monthLiqOnly ? '✓ 已過濾日成交值 > 5,000 萬' : '顯示全市場（含低量股）'}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 本月漲幅最強 TOP 25 */}
              <div className="bg-slate-900/90 border border-rose-500/25 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-400 mb-3">🚀 本月漲幅最強勢 TOP 25</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">排名/個股</th>
                        <th className="py-2 text-right">收盤價</th>
                        <th className="py-2 text-right">本月漲幅</th>
                        <th className="py-2 text-right">上月漲幅</th>
                        <th className="py-2 text-right">前二月</th>
                        <th className="py-2 text-right">成交值(億)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filterStock(monthLiqOnly ? (data.m_top_liq || []) : (data.m_top_all || [])).slice(0, 25).map((s, i) => (
                        <tr key={s.c} className="hover:bg-slate-800/40">
                          <td className="py-2 font-medium text-slate-200">
                            <span className="text-slate-500 font-mono mr-1.5">#{i + 1}</span>{s.c} {s.n}
                          </td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.p)}</td>
                          <td className={`py-2 text-right font-mono font-bold ${pctColor(s.m_curr)}`}>{pctSign(s.m_curr)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.m_prev1)}`}>{pctSign(s.m_prev1)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.m_prev2)}`}>{pctSign(s.m_prev2)}</td>
                          <td className="py-2 text-right font-mono text-slate-300">{fmtNum(s.amt_yi, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 本月跌幅最深 TOP 25 */}
              <div className="bg-slate-900/90 border border-emerald-500/25 rounded-xl p-4">
                <h3 className="text-sm font-bold text-emerald-400 mb-3">📉 本月回檔最深 TOP 25（成交值 &gt; 5,000 萬）</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">排名/個股</th>
                        <th className="py-2 text-right">收盤價</th>
                        <th className="py-2 text-right">本月跌幅</th>
                        <th className="py-2 text-right">上月漲幅</th>
                        <th className="py-2 text-right">前二月</th>
                        <th className="py-2 text-right">成交值(億)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filterStock(data.m_bot_liq || []).slice(0, 25).map((s, i) => (
                        <tr key={s.c} className="hover:bg-slate-800/40">
                          <td className="py-2 font-medium text-slate-200">
                            <span className="text-slate-500 font-mono mr-1.5">#{i + 1}</span>{s.c} {s.n}
                          </td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.p)}</td>
                          <td className={`py-2 text-right font-mono font-bold ${pctColor(s.m_curr)}`}>{pctSign(s.m_curr)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.m_prev1)}`}>{pctSign(s.m_prev1)}</td>
                          <td className={`py-2 text-right font-mono ${pctColor(s.m_prev2)}`}>{pctSign(s.m_prev2)}</td>
                          <td className="py-2 text-right font-mono text-slate-300">{fmtNum(s.amt_yi, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            TAB 4: 外資投信買賣超 TOP 10 & 投信進場
           ================================================================= */}
        {activeTab === 'inst' && (
          <div className="space-y-6">
            {/* 外資 & 投信買賣超 TOP 10 雙表 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 外資買超 TOP 10 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-400 mb-3">🌐 外資上市櫃買超 TOP 10（張數）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">#</th>
                      <th className="py-1.5 text-left">上市買超</th>
                      <th className="py-1.5 text-right">張數</th>
                      <th className="py-1.5 text-left pl-3">上櫃買超</th>
                      <th className="py-1.5 text-right">張數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.inst_top?.foreign_buy || []).map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono text-slate-500">{i + 1}</td>
                        <td className="py-1.5 font-medium text-slate-200">{r.twse_n}</td>
                        <td className="py-1.5 text-right font-mono text-rose-400">+{fmtInt(r.twse_v)}</td>
                        <td className="py-1.5 font-medium text-slate-200 pl-3">{r.tpex_n}</td>
                        <td className="py-1.5 text-right font-mono text-rose-400">+{fmtInt(r.tpex_v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 投信買超 TOP 10 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-400 mb-3">🏦 投信上市櫃買超 TOP 10（張數）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">#</th>
                      <th className="py-1.5 text-left">上市買超</th>
                      <th className="py-1.5 text-right">張數</th>
                      <th className="py-1.5 text-left pl-3">上櫃買超</th>
                      <th className="py-1.5 text-right">張數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.inst_top?.trust_buy || []).map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono text-slate-500">{i + 1}</td>
                        <td className="py-1.5 font-medium text-slate-200">{r.twse_n}</td>
                        <td className="py-1.5 text-right font-mono text-amber-400">+{fmtInt(r.twse_v)}</td>
                        <td className="py-1.5 font-medium text-slate-200 pl-3">{r.tpex_n}</td>
                        <td className="py-1.5 text-right font-mono text-amber-400">+{fmtInt(r.tpex_v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 外資賣超 TOP 10 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-emerald-400 mb-3">🌐 外資上市櫃賣超 TOP 10（張數）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">#</th>
                      <th className="py-1.5 text-left">上市賣超</th>
                      <th className="py-1.5 text-right">張數</th>
                      <th className="py-1.5 text-left pl-3">上櫃賣超</th>
                      <th className="py-1.5 text-right">張數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.inst_top?.foreign_sell || []).map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono text-slate-500">{i + 1}</td>
                        <td className="py-1.5 font-medium text-slate-200">{r.twse_n}</td>
                        <td className="py-1.5 text-right font-mono text-emerald-400">{fmtInt(r.twse_v)}</td>
                        <td className="py-1.5 font-medium text-slate-200 pl-3">{r.tpex_n}</td>
                        <td className="py-1.5 text-right font-mono text-emerald-400">{fmtInt(r.tpex_v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 投信賣超 TOP 10 */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-emerald-400 mb-3">🏦 投信上市櫃賣超 TOP 10（張數）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">#</th>
                      <th className="py-1.5 text-left">上市賣超</th>
                      <th className="py-1.5 text-right">張數</th>
                      <th className="py-1.5 text-left pl-3">上櫃賣超</th>
                      <th className="py-1.5 text-right">張數</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.inst_top?.trust_sell || []).map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono text-slate-500">{i + 1}</td>
                        <td className="py-1.5 font-medium text-slate-200">{r.twse_n}</td>
                        <td className="py-1.5 text-right font-mono text-emerald-400">{fmtInt(r.twse_v)}</td>
                        <td className="py-1.5 font-medium text-slate-200 pl-3">{r.tpex_n}</td>
                        <td className="py-1.5 text-right font-mono text-emerald-400">{fmtInt(r.tpex_v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 投信連買 & 投信剛買 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-300 mb-3">📈 策略：投信連買認養清單</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">個股</th>
                        <th className="py-2 text-right">收盤/漲幅</th>
                        <th className="py-2 text-center">連買天</th>
                        <th className="py-2 text-right">買超張</th>
                        <th className="py-2 text-right">持股%</th>
                        <th className="py-2 text-right">投本比%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filterStock(data.it_streak || []).map((s) => (
                        <tr key={s.c}>
                          <td className="py-2 font-medium text-slate-200">{s.c} {s.n}</td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.p)} <span className={pctColor(s.chg)}>({pctSign(s.chg)})</span></td>
                          <td className="py-2 text-center"><span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">{s.days}日</span></td>
                          <td className="py-2 text-right font-mono text-rose-400">+{fmtNum(s.lots, 1)}</td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.hold, 2)}%</td>
                          <td className="py-2 text-right font-mono text-sky-300">{fmtNum(s.cap_r, 2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-300 mb-3">🎯 策略：投信剛買（首日進場點火）</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 text-left">個股</th>
                        <th className="py-2 text-right">收盤/漲幅</th>
                        <th className="py-2 text-center">連買天</th>
                        <th className="py-2 text-right">買超張</th>
                        <th className="py-2 text-right">投本比%</th>
                        <th className="py-2 text-right">5日量比</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filterStock(data.it_fresh || []).map((s) => (
                        <tr key={s.c}>
                          <td className="py-2 font-medium text-slate-200">{s.c} {s.n}</td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.p)} <span className={pctColor(s.chg)}>({pctSign(s.chg)})</span></td>
                          <td className="py-2 text-center"><span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">{s.days}日</span></td>
                          <td className="py-2 text-right font-mono text-rose-400">+{fmtNum(s.lots, 1)}</td>
                          <td className="py-2 text-right font-mono text-sky-300">{fmtNum(s.cap_r, 2)}%</td>
                          <td className="py-2 text-right font-mono">{fmtNum(s.vr5, 2)}x</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================
            TAB 5: 技術型態突破 & 107 個細產業輪動
           ================================================================= */}
        {activeTab === 'sector' && (
          <div className="space-y-6">
            {/* 技術型態突破雷達三欄 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-slate-900/90 border border-rose-500/25 rounded-xl p-4">
                <h3 className="text-sm font-bold text-rose-400 mb-2">🏆 帶量突破多均線（量增 &gt; 100%）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">個股</th>
                      <th className="py-1.5 text-right">收盤價</th>
                      <th className="py-1.5 text-right">量增%</th>
                      <th className="py-1.5 text-right">成交值(萬)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.sd_breakout || []).map((s) => (
                      <tr key={s.c}>
                        <td className="py-1.5 font-medium text-slate-200">{s.c} {s.n}</td>
                        <td className="py-1.5 text-right font-mono">{fmtNum(s.p)}</td>
                        <td className="py-1.5 text-right font-mono text-rose-400">+{fmtNum(s.vol_chg, 0)}%</td>
                        <td className="py-1.5 text-right font-mono text-slate-300">{fmtInt(s.amt_k / 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900/90 border border-amber-500/25 rounded-xl p-4">
                <h3 className="text-sm font-bold text-amber-400 mb-2">🔥 量增紅K（爆量長紅表態）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">個股</th>
                      <th className="py-1.5 text-right">收盤價</th>
                      <th className="py-1.5 text-right">量增%</th>
                      <th className="py-1.5 text-right">成交張</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.sd_vol_red || []).map((s) => (
                      <tr key={s.c}>
                        <td className="py-1.5 font-medium text-slate-200">{s.c} {s.n}</td>
                        <td className="py-1.5 text-right font-mono">{fmtNum(s.p)}</td>
                        <td className="py-1.5 text-right font-mono text-amber-400">+{fmtNum(s.vol_chg, 0)}%</td>
                        <td className="py-1.5 text-right font-mono text-slate-300">{fmtInt(s.v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900/90 border border-purple-500/25 rounded-xl p-4">
                <h3 className="text-sm font-bold text-purple-400 mb-2">⚡ 高券資比軋空潛力（&gt; 30%）</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="py-1.5 text-left">個股</th>
                      <th className="py-1.5 text-right">券資比</th>
                      <th className="py-1.5 text-right">當沖比</th>
                      <th className="py-1.5 text-right">漲幅%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {(data.sd_short || []).map((s) => (
                      <tr key={s.c}>
                        <td className="py-1.5 font-medium text-slate-200">{s.c} {s.n}</td>
                        <td className="py-1.5 text-right font-mono text-purple-300 font-bold">{fmtNum(s.ratio, 1)}%</td>
                        <td className="py-1.5 text-right font-mono text-slate-400">{fmtNum(s.dt * 100, 1)}%</td>
                        <td className={`py-1.5 text-right font-mono ${pctColor(s.chg)}`}>{pctSign(s.chg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 107 個細產業類股漲跌幅排行 */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-white">📊 107 個自訂細產業類股強弱輪動</h3>
                  <p className="text-xs text-slate-400">涵蓋傳產、電子上游、電子下游所有核心次產業族群</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {['ALL', '電子上游', '電子下游', '傳產'].map((g) => (
                    <button
                      key={g}
                      onClick={() => setSectorGroup(g)}
                      className={`px-3 py-1.5 rounded-lg border ${
                        sectorGroup === g ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {g === 'ALL' ? '全部 (107)' : g}
                    </button>
                  ))}
                  <select
                    value={sectorSort}
                    onChange={(e) => setSectorSort(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="d">依日報酬排序</option>
                    <option value="w">依週報酬排序</option>
                    <option value="m">依月報酬排序</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[540px] overflow-y-auto pr-1">
                {sortedSectors.map((sec, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      sec.d > 0
                        ? 'bg-rose-950/20 border-rose-500/25'
                        : sec.d < 0
                        ? 'bg-emerald-950/20 border-emerald-500/25'
                        : 'bg-slate-800/40 border-slate-800'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block">{sec.g}</span>
                        <span className="text-sm font-bold text-slate-100">{sec.n}</span>
                      </div>
                      <span className={`text-sm font-bold font-mono ${pctColor(sec.d)}`}>
                        {pctSign(sec.d)}
                      </span>
                    </div>
                    <div className="mt-2 pt-1.5 border-t border-slate-800/70 flex justify-between text-[11px] text-slate-400 font-mono">
                      <span>週 <strong className={pctColor(sec.w)}>{pctSign(sec.w)}</strong></span>
                      <span>月 <strong className={pctColor(sec.m)}>{sec.m !== null ? pctSign(sec.m) : '-'}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
