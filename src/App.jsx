import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Radar, CalendarRange, Building2, Layers,
  TrendingUp, TrendingDown, Search, SlidersHorizontal, RefreshCw,
  Sparkles, BarChart3, Activity
} from 'lucide-react';

const fmtNum = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '-'
    : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '-'
    : Math.round(Number(n)).toLocaleString('zh-TW');
const pctColor = (v) => (Number(v) > 0 ? 'text-rose-400' : Number(v) < 0 ? 'text-emerald-400' : 'text-slate-300');
const pctSign = (v) => (Number(v) > 0 ? `+${fmtNum(v)}%` : `${fmtNum(v)}%`);
const amtColor = (v) => (Number(v) > 0 ? 'text-rose-400' : Number(v) < 0 ? 'text-emerald-400' : 'text-slate-300');
const amtSign = (v) => (Number(v) > 0 ? `+${fmtNum(v, 2)}` : `${fmtNum(v, 2)}`);

const HEAVY_EXCLUDE = new Set(['2330', '2317', '2454', '2412', '2308', '2382', '3045', '4904', '6505', '1301', '1303', '2002', '1216']);
const isExcludedMegaCap = (code) => {
  const c = String(code || '').trim();
  return c.startsWith('28') || c.startsWith('58') || HEAVY_EXCLUDE.has(c);
};

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');

  // 籌碼篩選可調參數門檻
  const [dispThresh, setDispThresh] = useState(20);
  const [dtThresh, setDtThresh] = useState(40);
  const [marginThresh, setMarginThresh] = useState(25);
  const [itMinAmt, setItMinAmt] = useState(20000);
  const [showParams, setShowParams] = useState(false);

  // 技術突破細產業篩選
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

  const evaluatedV7 = useMemo(() => {
    if (!data?.v7_stocks) return [];
    return data.v7_stocks
      .filter((s) => !isExcludedMegaCap(s.c))
      .map((s) => {
        const sd = s.d1 > dispThresh && s.dd > 10 ? 1 : 0;
        const sdt = s.dt1 > dtThresh && (s.dt1 - (s.dt5 || 0)) >= 0 ? 1 : 0;
        const sm = s.m1 > marginThresh && (s.m1 - (s.m5 || 0)) >= 0 ? 1 : 0;
        const smf = s.smf || (s.mf1 < -5 && s.mf5 < -3 ? 1 : 0);
        const sit = s.it5_amt < -itMinAmt ? 1 : 0;
        const bs = sd + sdt + sm + smf + sit;

        const sg = s.mf5 > 3 && s.d1 < -15 && s.dd < -10 && s.dt1 >= 15 && s.dt1 <= dtThresh ? 1 : (s.sg === 1 ? 1 : 0);
        const sit_buy = s.it5_amt >= itMinAmt && (s.sit_buy === 1 || s.sms === 1) ? 1 : 0;
        const sms = s.sms === 1 ? 1 : 0;
        const isWavePrime = (sg === 1 || sit_buy === 1) && sms === 1;

        let dynamicAdv = s.adv || '－中性觀望';
        if (isWavePrime) {
          dynamicAdv = '★波段首選：主力/投信轉佳+資減價穩（開盤打大）';
        } else if (sit_buy === 1) {
          dynamicAdv = '🏦投信真金認養：機構連買守成本（開盤可進場）';
        } else if (sg === 1) {
          dynamicAdv = '▲主力吸籌集中：分點籌碼轉佳（開盤可進場）';
        } else if (bs >= 2 && s.chg >= -2) {
          dynamicAdv = '▼高檔籌碼惡化：打黑K首選 / 波段改尾盤';
        } else if (bs >= 2) {
          dynamicAdv = '▽籌碼惡化(已跌)：波段避開 / 勿追低空';
        } else if (s.chg >= 3 && bs >= 1) {
          dynamicAdv = '⚡次級打黑K觀察：逆勢大漲＋單項籌碼過熱';
        }

        return { ...s, sd, sdt, sm, smf, sit, bs, sg, sit_buy, sms, isWavePrime, dynamicAdv };
      });
  }, [data, dispThresh, dtThresh, marginThresh, itMinAmt]);

  const v7Stats = useMemo(() => {
    const wavePrime = evaluatedV7.filter((s) => s.isWavePrime);
    const itAdopt = evaluatedV7.filter((s) => s.sit_buy === 1);
    const mfFocus = evaluatedV7.filter((s) => s.sg === 1);

    const pureGoodList = evaluatedV7
      .filter((s) => s.isWavePrime || s.sg === 1 || s.sit_buy === 1)
      .sort((a, b) => {
        const tierA = a.isWavePrime ? 3 : a.sg === 1 ? 2 : 1;
        const tierB = b.isWavePrime ? 3 : b.sg === 1 ? 2 : 1;
        if (tierB !== tierA) return tierB - tierA;
        return (b.sc || 0) - (a.sc || 0);
      });

    // 空方／打黑K榜單：嚴格優先依「惡化分數 (bs) 由高到低」排序（5分、4分、3分最差排最前），同分再優先排高檔打黑K首選
    const blackKPrime = evaluatedV7.filter((s) => s.bs >= 2 && s.chg >= -2);
    const blackKSub = evaluatedV7.filter((s) => s.chg >= 3 && s.bs >= 1);
    const pureBadList = evaluatedV7
      .filter((s) => s.bs >= 2 || (s.chg >= 3 && s.bs >= 1))
      .sort((a, b) => {
        if (b.bs !== a.bs) return b.bs - a.bs;
        const isPrimeA = a.bs >= 2 && a.chg >= -2 ? 2 : 1;
        const isPrimeB = b.bs >= 2 && b.chg >= -2 ? 2 : 1;
        if (isPrimeB !== isPrimeA) return isPrimeB - isPrimeA;
        return (a.sc || 0) - (b.sc || 0);
      });

    const dispList = evaluatedV7.filter((s) => s.sd === 1).sort((a, b) => b.d1 - a.d1);
    const dtHotList = evaluatedV7.filter((s) => s.sdt === 1).sort((a, b) => b.dt1 - a.dt1);
    const retailList = evaluatedV7.filter((s) => s.sm === 1).sort((a, b) => b.m1 - a.m1);

    return {
      wavePrime,
      itAdopt,
      mfFocus,
      blackKPrime,
      blackKSub,
      dispList,
      dtHotList,
      retailList,
      pureGoodList,
      pureBadList
    };
  }, [evaluatedV7]);

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
  const filterStock = (arr) =>
    !q ? arr : arr.filter((s) => String(s.c).toLowerCase().includes(q) || String(s.n).toLowerCase().includes(q));

  const tabs = [
    { id: 'home', label: '首頁大盤總覽', icon: LayoutDashboard },
    { id: 'v7', label: '籌碼篩選', icon: Radar },
    { id: 'month', label: '當月漲跌幅排行', icon: CalendarRange },
    { id: 'inst', label: '法人買賣超', icon: Building2 },
    { id: 'sector', label: '技術突破', icon: Layers }
  ];

  // 當月漲跌幅：強勢只顯示正漲幅，弱勢只顯示負跌幅，雙榜皆過濾成交值 > 5,000 萬
  const monthStrongList = (data.m_top_liq || []).filter((s) => Number(s.amt_yi) >= 0.5 && Number(s.m_curr) > 0).slice(0, 25);
  const monthWeakList = (data.m_bot_liq || []).filter((s) => Number(s.amt_yi) >= 0.5 && Number(s.m_curr) < 0).slice(0, 25);

  const sortedSectors = [...(data.sectors || [])]
    .filter((s) => sectorGroup === 'ALL' || s.g === sectorGroup)
    .filter((s) => !q || s.n.toLowerCase().includes(q))
    .sort((a, b) => (b[sectorSort] ?? -999) - (a[sectorSort] ?? -999));

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 pb-16">
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
                大盤基準日：<span className="text-slate-200 font-medium">{data.trade_date}</span>
                {data.v7_trade_date && data.v7_trade_date !== data.trade_date && (
                  <> ｜ 籌碼基準日：<span className="text-amber-300 font-medium">{data.v7_trade_date}</span></>
                )}
                {' '}｜ 更新：{data.updated_at}
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
        {/* TAB 1: 首頁大盤總覽 */}
        {activeTab === 'home' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
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

              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" /> 多空策略雷達即時統計（點擊前往明細）
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 hover:border-rose-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-rose-300">★ 波段首選（雙引擎轉佳＋資減）</span>
                      <span className="text-xl font-bold font-mono text-rose-400">{v7Stats.wavePrime.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-40
