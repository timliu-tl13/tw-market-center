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

// 排除權值與金融股的防呆清單（確保舊資料也不會混入台積電、中華電、金融股）
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

  // 動態重算「籌碼篩選」指標（排除大型權值與金融股）
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

        // 多方訊號：主力吸籌集中 (sg) 或 投信真金認養 (sit_buy)
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

    // 1. 多方名單：只收錄「波段首選 + 主力吸籌 + 投信認養」，絕不拿中性或打黑K湊數；若超過15檔則全部顯示
    const pureGoodList = evaluatedV7
      .filter((s) => s.isWavePrime || s.sg === 1 || s.sit_buy === 1)
      .sort((a, b) => {
        const tierA = a.isWavePrime ? 3 : a.sg === 1 ? 2 : 1;
        const tierB = b.isWavePrime ? 3 : b.sg === 1 ? 2 : 1;
        if (tierB !== tierA) return tierB - tierA;
        return (b.sc || 0) - (a.sc || 0);
      });

    // 2. 空方／打黑K名單：只收錄「高檔籌碼惡化 (bs>=2) + 次級打黑K觀察」，絕不拿1分微幅波動湊數；若超過15檔全部顯示
    const blackKPrime = evaluatedV7.filter((s) => s.bs >= 2 && s.chg >= -2);
    const blackKSub = evaluatedV7.filter((s) => s.chg >= 3 && s.bs >= 1);
    const pureBadList = evaluatedV7
      .filter((s) => s.bs >= 2 || (s.chg >= 3 && s.bs >= 1))
      .sort((a, b) => {
        const isPrimeA = a.bs >= 2 && a.chg >= -2 ? 3 : a.chg >= 3 && a.bs >= 1 ? 2 : 1;
        const isPrimeB = b.bs >= 2 && b.chg >= -2 ? 3 : b.chg >= 3 && b.bs >= 1 ? 2 : 1;
        if (isPrimeB !== isPrimeA) return isPrimeB - isPrimeA;
        if (b.bs !== a.bs) return b.bs - a.bs;
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

  // 依需求重新命名導覽頁籤
  const tabs = [
    { id: 'home', label: '首頁大盤總覽', icon: LayoutDashboard },
    { id: 'v7', label: '籌碼篩選', icon: Radar },
    { id: 'month', label: '當月漲跌幅排行', icon: CalendarRange },
    { id: 'inst', label: '法人買賣超', icon: Building2 },
    { id: 'sector', label: '技術突破', icon: Layers }
  ];

  // 當月漲跌幅：強勢與弱勢皆嚴格過濾成交值 > 5,000 萬 (0.5 億)
  const monthStrongList = (data.m_top_liq || []).filter((s) => Number(s.amt_yi) >= 0.5).slice(0, 25);
  const monthWeakList = (data.m_bot_liq || []).filter((s) => Number(s.amt_yi) >= 0.5).slice(0, 25);

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
            TAB 1: 首頁大盤總覽
           ================================================================= */}
        {activeTab === 'home' && (
          <>
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

            {/* 全市場多空結構廣度 & 策略即時統計 */}
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
                    <p className="text-[11px] text-slate-400 mt-1">主力與投信同步偏多且融資沉澱站穩月線</p>
                  </button>

                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 hover:border-amber-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-amber-300">▲ 主力吸籌 ＆ 🏦 投信認養</span>
                      <span className="text-xl font-bold font-mono text-amber-400">{v7Stats.pureGoodList.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">分點集中吸籌或投信連買守穩成本區</p>
                  </button>

                  <button onClick={() => setActiveTab('v7')} className="text-left p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 hover:border-emerald-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-emerald-300">▼ 打黑K首選 ＆ 籌碼惡化警戒</span>
                      <span className="text-xl font-bold font-mono text-emerald-400">{v7Stats.pureBadList.length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">籌碼發散、當沖過熱或高檔主力倒貨轉弱</p>
                  </button>

                  <button onClick={() => setActiveTab('sector')} className="text-left p-3.5 rounded-xl bg-sky-950/30 border border-sky-500/30 hover:border-sky-400 transition">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-sky-300">🏆 帶量突破 ＆ 技術轉強標的</span>
                      <span className="text-xl font-bold font-mono text-sky-400">{(data.sd_breakout || []).length} 檔</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">爆量站上多均線與 107 個細產業輪動追蹤</p>
                  </button>
                </div>
              </div>
            </div>

            {/* 首頁精選快覽 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-rose-300">★ 今日波段首選 ＆ 籌碼轉佳精選</h3>
                  <button onClick={() => setActiveTab('v7')} className="text-xs text-sky-400 hover:underline">查看完整籌碼篩選 →</button>
                </div>
                {v7Stats.pureGoodList.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-400">當日無符合波段首選或主力吸籌之標的</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-800">
                          <th className="py-2 text-left">代號/名稱</th>
                          <th className="py-2 text-right">收盤</th>
                          <th className="py-2 text-right">漲幅</th>
                          <th className="py-2 text-right">5日主力%</th>
                          <th className="py-2 text-left pl-2">策略判讀</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {v7Stats.pureGoodList.slice(0, 8).map((s) => (
                          <tr key={s.c} className="hover:bg-slate-800/40">
                            <td className="py-2 font-medium text-slate-200">{s.c} {s.n}</td>
                            <td className="py-2 text-right font-mono">{fmtNum(s.p)}</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.chg)}`}>{pctSign(s.chg)}</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.mf5)}`}>{pctSign(s.mf5)}</td>
                            <td className="py-2 pl-2 text-amber-300">{s.dynamicAdv.split('：')[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-bold text-amber-300">🔥 強勢細產業類股 TOP 8（今日漲幅）</h3>
                  <button onClick={() => setActiveTab('sector')} className="text-xs text-sky-400 hover:underline">查看全部技術突破 →</button>
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
            TAB 2: 籌碼篩選（只列真正波段首選/主力吸籌/投信認養 與 打黑K/籌碼惡化）
           ================================================================= */}
        {activeTab === 'v7' && (
          <>
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
                    散戶追價(空)：<strong>{v7Stats.retailList.length === 0 ? '0 檔（無觸發）' : `${v7Stats.retailList.length} 檔`}</strong>
                  </span>
                </div>

                <button
                  onClick={() => setShowParams(!showParams)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> 參數門檻設定
                </button>
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

            {/* 雙榜：只顯示真正符合條件的標的（有幾檔顯示幾檔，不硬湊中性股） */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 多方榜單：波段首選 + 主力吸籌 + 投信認養 */}
              <div className="bg-slate-900/90 border border-rose-500/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> 波段首選 ＆ 籌碼轉佳名單（共 {v7Stats.pureGoodList.length} 檔）
                  </h2>
                  <span className="text-[11px] text-slate-400">僅列達標股・無硬湊</span>
                </div>
                {v7Stats.pureGoodList.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    當日無符合「波段首選、主力吸籌或投信認養」條件之個股
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-900">
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
                        {filterStock(v7Stats.pureGoodList).map((s) => (
                          <tr key={s.c} className="hover:bg-slate-800/40">
                            <td className="py-2 font-medium text-slate-200 whitespace-nowrap">{s.c} {s.n}</td>
                            <td className="py-2 text-right font-mono whitespace-nowrap">
                              {fmtNum(s.p)} <span className={pctColor(s.chg)}>({pctSign(s.chg)})</span>
                            </td>
                            <td className="py-2 text-right font-mono text-rose-300">{fmtNum(s.d1, 1)}%</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.mf5)}`}>{pctSign(s.mf5)}</td>
                            <td className={`py-2 text-right font-mono ${pctColor(s.it5_amt)}`}>{fmtInt(s.it5_amt)}</td>
                            <td className="py-2 pl-2 text-[11px] text-amber-300 whitespace-nowrap">{s.dynamicAdv.split('：')[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 空方榜單：打黑K首選 + 籌碼惡化警戒 */}
              <div className="bg-slate-900/90 border border-emerald-500/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" /> 打黑K首選 ＆ 籌碼惡化警戒（共 {v7Stats.pureBadList.length} 檔）
                  </h2>
                  <span className="text-[11px] text-slate-400">高檔轉弱・發散過熱</span>
                </div>
                {v7Stats.pureBadList.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    當日無符合「打黑K首選或高檔籌碼惡化」條件之個股
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
