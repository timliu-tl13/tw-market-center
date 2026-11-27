import os
import json
import time
from datetime import datetime, timedelta
import requests
import urllib3
import pandas as pd

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()
FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
OUTPUT_PATH = "public/market_dashboard_data.json"
SECTOR_MAP_PATH = "scripts/sector_mapping.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*"
}

def sfloat(val, default=0.0):
    if val is None:
        return default
    s = str(val).replace(",", "").replace("+", "").replace("%", "").strip()
    if s in ["", "-", "--", "---", "N/A", "nan", "None", "X"]:
        return default
    try:
        return float(s)
    except Exception:
        return default

def sint(val, default=0):
    return int(round(sfloat(val, default)))

def get_json(url, params=None, timeout=20):
    for _ in range(3):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=timeout, verify=False)
            if r.status_code == 200:
                return r.json()
        except Exception:
            time.sleep(2)
    return None

def fetch_finmind(dataset, data_id="", start_date="", end_date=""):
    params = {"dataset": dataset, "start_date": start_date}
    if data_id:
        params["data_id"] = data_id
    if end_date and dataset != "TaiwanStockTradingDailyReport":
        params["end_date"] = end_date
    if FINMIND_TOKEN:
        params["token"] = FINMIND_TOKEN

    for _ in range(3):
        try:
            resp = requests.get(FINMIND_URL, params=params, timeout=30)
            data = resp.json()
            if data.get("msg") == "success":
                return pd.DataFrame(data.get("data", []))
            msg = str(data.get("msg", ""))
            if "limit" in msg.lower():
                print("⚠️ FinMind 達到每小時請求上限，暫停 60 秒...")
                time.sleep(60)
            else:
                return pd.DataFrame()
        except Exception:
            time.sleep(2)
    return pd.DataFrame()

def load_existing_json():
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def main():
    print("🚀 啟動台股多空戰情指揮中心全自動爬蟲（FinMind Sponsor 全市場直連版）...")
    now_tw = datetime.utcnow() + timedelta(hours=8)
    end_str = now_tw.strftime("%Y-%m-%d")
    start_cal_str = (now_tw - timedelta(days=120)).strftime("%Y-%m-%d")

    cal_df = fetch_finmind("TaiwanStockPrice", data_id="2330", start_date=start_cal_str, end_date=end_str)
    if cal_df.empty:
        print("❌ 無法從 FinMind 取得交易日曆，請確認 Token 狀態。")
        return

    all_dates = sorted(cal_df["date"].unique().tolist())
    latest_date = all_dates[-1]
    prev_trade_date = all_dates[-2] if len(all_dates) >= 2 else latest_date
    recent_5_days = all_dates[-5:]
    recent_60_days = all_dates[-60:]

    dt_latest = datetime.strptime(latest_date, "%Y-%m-%d")
    d60_start = (dt_latest - timedelta(days=115)).strftime("%Y-%m-%d")
    print(f"📅 確認最新大盤交易日: {latest_date}（前一日: {prev_trade_date}）")

    existing_data = load_existing_json()
    market_summary = existing_data.get("market_summary", {})
    market_summary["trade_date"] = latest_date

    info_df = fetch_finmind("TaiwanStockInfo")
    name_map = {}
    mkt_map = {}
    if not info_df.empty:
        for _, row in info_df.iterrows():
            sid = str(row.get("stock_id", "")).strip()
            if len(sid) == 4 and not sid.startswith("00"):
                name_map[sid] = str(row.get("stock_name", sid)).strip()
                t_type = str(row.get("type", "")).lower()
                mkt_map[sid] = "tpex" if ("otc" in t_type or "tpex" in t_type or "櫃" in t_type) else "twse"

    df_today_all = fetch_finmind("TaiwanStockPrice", start_date=latest_date, end_date=latest_date)
    if df_today_all.empty or len(df_today_all) < 500:
        print(f"⚠️ {latest_date} 全市場日K尚未完整結算（僅 {len(df_today_all)} 筆），保留舊資料不覆蓋。")
        return

    stocks_map = {}
    twse_amt_sum = 0.0
    tpex_amt_sum = 0.0

    for _, row in df_today_all.iterrows():
        code = str(row.get("stock_id", "")).strip()
        if len(code) != 4 or code.startswith("00"):
            continue
        cp = sfloat(row.get("close"))
        op = sfloat(row.get("open"))
        spread = sfloat(row.get("spread"))
        shares = sfloat(row.get("Trading_Volume"))
        val_ntd = sfloat(row.get("Trading_money"))
        if cp <= 0:
            continue
        vol_lots = sint(shares / 1000.0)
        amt_yi = round(val_ntd / 1e8, 2)
        avg_p = round(val_ntd / shares, 2) if shares > 0 else cp
        prev_p = cp - spread
        chg_pct = round(spread / prev_p * 100, 2) if prev_p > 0 else 0.0
        mkt = mkt_map.get(code, "twse")
        if mkt == "twse":
            twse_amt_sum += amt_yi
        else:
            tpex_amt_sum += amt_yi

        stocks_map[code] = {
            "c": code,
            "n": name_map.get(code, code),
            "mkt": mkt,
            "p": cp,
            "o": op,
            "avg_p": avg_p,
            "chg": chg_pct,
            "v": vol_lots,
            "amt_yi": amt_yi
        }

    print(f"✅ 成功載入全市場 {latest_date} 收盤個股: {len(stocks_map)} 檔")

    tot_cnt = len(stocks_map)
    red_k = sum(1 for s in stocks_map.values() if s["p"] > s["o"])
    black_k = sum(1 for s in stocks_map.values() if s["p"] < s["o"])
    up_cnt = sum(1 for s in stocks_map.values() if s["chg"] > 0)
    dn_cnt = sum(1 for s in stocks_map.values() if s["chg"] < 0)
    market_summary["breadth"] = [
        {"name": "個股總數", "count": tot_cnt, "pct": 100.0},
        {"name": "當日紅K", "count": red_k, "pct": round(red_k / tot_cnt * 100, 2)},
        {"name": "當日黑K", "count": black_k, "pct": round(black_k / tot_cnt * 100, 2)},
        {"name": "當日上漲", "count": up_cnt, "pct": round(up_cnt / tot_cnt * 100, 2)},
        {"name": "當日下跌", "count": dn_cnt, "pct": round(dn_cnt / tot_cnt * 100, 2)},
    ]

    taiex_df = fetch_finmind("TaiwanStockPrice", data_id="TAIEX", start_date=prev_trade_date, end_date=latest_date)
    if not taiex_df.empty:
        t_row = taiex_df[taiex_df["date"] == latest_date].iloc[-1]
        idx_val = round(sfloat(t_row.get("close")), 2)
        pts_val = round(sfloat(t_row.get("spread")), 2)
        prev_idx = idx_val - pts_val
        chg_val = round(pts_val / prev_idx * 100, 2) if prev_idx > 0 else 0.0
        if idx_val > 0:
            market_summary["twse_index"] = idx_val
            market_summary["twse_pts"] = pts_val
            market_summary["twse_chg"] = chg_val
            market_summary["twse_amt"] = round(twse_amt_sum, 1)

    yf_tpex = get_json("https://query1.finance.yahoo.com/v8/finance/chart/%5ETWOII?range=5d&interval=1d")
    try:
        closes = [c for c in yf_tpex["chart"]["result"][0]["indicators"]["quote"][0]["close"] if c is not None]
        if len(closes) >= 2:
            t_close, t_prev = float(closes[-1]), float(closes[-2])
            t_chg = t_close - t_prev
            market_summary["tpex_index"] = round(t_close, 2)
            market_summary["tpex_pts"] = round(t_chg, 2)
            market_summary["tpex_chg"] = round(t_chg / t_prev * 100, 2) if t_prev > 0 else 0.0
    except Exception:
        pass
    if tpex_amt_sum > 50:
        market_summary["tpex_amt"] = round(tpex_amt_sum, 1)

    inst_mkt_df = fetch_finmind("TaiwanStockTotalInstitutionalInvestors", start_date=latest_date, end_date=latest_date)
    if not inst_mkt_df.empty:
        f_net, t_net, d_net = 0.0, 0.0, 0.0
        for _, r in inst_mkt_df.iterrows():
            nm = str(r.get("name", ""))
            diff_yi = (sfloat(r.get("buy")) - sfloat(r.get("sell"))) / 1e8
            if "Foreign_Investor" in nm:
                f_net += diff_yi
            elif "Investment_Trust" in nm:
                t_net += diff_yi
            elif "Dealer" in nm:
                d_net += diff_yi
        market_summary["foreign_net"] = round(f_net, 2)
        market_summary["trust_net"] = round(t_net, 2)
        market_summary["dealer_net"] = round(d_net, 2)
        market_summary["inst_total"] = round(f_net + t_net + d_net, 2)

    inst_top = existing_data.get("inst_top", {"foreign_buy": [], "foreign_sell": [], "trust_buy": [], "trust_sell": []})
    twse_f_amt, twse_t_amt, tpex_f_amt, tpex_t_amt = [], [], [], []
    trust_5d_amt_map = {}

    inst_60d_df = fetch_finmind("TaiwanStockInstitutionalInvestorsBuySell", start_date=recent_60_days[0], end_date=latest_date)
    if not inst_60d_df.empty:
        inst_60d_df["net_lots"] = (inst_60d_df["buy"] - inst_60d_df["sell"]) / 1000.0

        df_today_inst = inst_60d_df[inst_60d_df["date"] == latest_date]
        for code, grp in df_today_inst.groupby("stock_id"):
            code = str(code).strip()
            if code not in stocks_map:
                continue
            st = stocks_map[code]
            f_lots = float(grp[grp["name"].str.contains("Foreign_Investor", na=False)]["net_lots"].sum())
            t_lots = float(grp[grp["name"] == "Investment_Trust"]["net_lots"].sum())
            f_yi = round(f_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            t_yi = round(t_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            if st["mkt"] == "twse":
                twse_f_amt.append((st["n"], f_yi))
                twse_t_amt.append((st["n"], t_yi))
            else:
                tpex_f_amt.append((st["n"], f_yi))
                tpex_t_amt.append((st["n"], t_yi))

        t_all_df = inst_60d_df[inst_60d_df["name"] == "Investment_Trust"].copy()
        t_5d_only = t_all_df[t_all_df["date"].isin(recent_5_days)]
        for code, grp in t_5d_only.groupby("stock_id"):
            code = str(code).strip()
            if code in stocks_map:
                lots_5d = float(grp["net_lots"].sum())
                trust_5d_amt_map[code] = int(round(lots_5d * stocks_map[code]["avg_p"]))

    if twse_f_amt and tpex_f_amt:
        def zip_top10_amt(a, b):
            return [
                {
                    "twse_n": a[i][0] if i < len(a) else "-",
                    "twse_v": a[i][1] if i < len(a) else 0.0,
                    "tpex_n": b[i][0] if i < len(b) else "-",
                    "tpex_v": b[i][1] if i < len(b) else 0.0,
                }
                for i in range(10)
            ]
        inst_top["foreign_buy"] = zip_top10_amt(sorted(twse_f_amt, key=lambda x: x[1], reverse=True)[:10], sorted(tpex_f_amt, key=lambda x: x[1], reverse=True)[:10])
        inst_top["foreign_sell"] = zip_top10_amt(sorted(twse_f_amt, key=lambda x: x[1])[:10], sorted(tpex_f_amt, key=lambda x: x[1])[:10])
        inst_top["trust_buy"] = zip_top10_amt(sorted(twse_t_amt, key=lambda x: x[1], reverse=True)[:10], sorted(tpex_t_amt, key=lambda x: x[1], reverse=True)[:10])
        inst_top["trust_sell"] = zip_top10_amt(sorted(twse_t_amt, key=lambda x: x[1])[:10], sorted(tpex_t_amt, key=lambda x: x[1])[:10])

    it_fresh = []
    it_streak = [x for x in existing_data.get("it_streak", []) if str(x.get("c", "")).strip().isdigit()]
    if not inst_60d_df.empty:
        t_all_df = inst_60d_df[inst_60d_df["name"] == "Investment_Trust"].copy()
        fresh_candidates = []
        streak_candidates = []
        for code, grp in t_all_df.groupby("stock_id"):
            code = str(code).strip()
            if code not in stocks_map:
                continue
            st = stocks_map[code]
            grp = grp.sort_values("date")
            today_rows = grp[grp["date"] == latest_date]
            if today_rows.empty:
                continue
            today_lots = float(today_rows["net_lots"].sum())
            if today_lots < 1:
                continue

            past_grp = grp[grp["date"] < latest_date]
            past_any_buy = bool((past_grp["net_lots"] > 0).any()) if not past_grp.empty else False

            streak_days = 0
            for v in reversed(grp["net_lots"].tolist()):
                if v > 0:
                    streak_days += 1
                else:
                    break

            item_obj = {
                "c": code, "n": st["n"], "p": st["p"], "chg": st["chg"],
                "days": max(streak_days, 1), "lots": round(today_lots, 1), "hold": 0.0,
                "cap_r": round(today_lots / max(st["v"], 1) * 100, 2),
                "v": st["v"], "vr5": 1.0,
                "_amt": today_lots * st["avg_p"]
            }

            if not past_any_buy and streak_days == 1:
                fresh_candidates.append(item_obj)
            elif streak_days >= 2:
                streak_candidates.append(item_obj)

        it_fresh = sorted(fresh_candidates, key=lambda x: x["c"])[:35]
        for x in it_fresh:
            x.pop("_amt", None)
        if streak_candidates:
            it_streak = sorted(streak_candidates, key=lambda x: (x["days"], x["_amt"]), reverse=True)[:25]
            for x in it_streak:
                x.pop("_amt", None)

    margin_map = {}
    mg_df = fetch_finmind("TaiwanStockMarginPurchaseShortSale", start_date=latest_date, end_date=latest_date)
    if not mg_df.empty:
        for _, r in mg_df.iterrows():
            code = str(r.get("stock_id", "")).strip()
            curr_b = sfloat(r.get("MarginPurchaseTodayBalance"))
            prev_b = sfloat(r.get("MarginPurchaseYesterdayBalance"))
            lim_b = sfloat(r.get("MarginPurchaseLimit"))
            ur = round(curr_b / lim_b * 100, 2) if lim_b > 0 else 0.0
            margin_map[code] = {"m1": ur, "mc": sint(curr_b - prev_b)}

    mg_tot_df = fetch_finmind("TaiwanStockTotalMarginPurchaseShortSale", start_date=latest_date, end_date=latest_date)
    if not mg_tot_df.empty:
        for _, r in mg_tot_df.iterrows():
            nm = str(r.get("name", ""))
            if "MarginPurchaseMoney" in nm:
                curr_m = sfloat(r.get("TodayBalance")) / 1e8
                prev_m = sfloat(r.get("YesBalance")) / 1e8
                if curr_m > 500:
                    market_summary["margin_bal"] = round(curr_m, 1)
                    market_summary["margin_chg"] = round(curr_m - prev_m, 1)
            elif "ShortSale" in nm and "Money" not in nm:
                curr_s = sfloat(r.get("TodayBalance")) / 1e4
                prev_s = sfloat(r.get("YesBalance")) / 1e4
                if curr_s > 0:
                    market_summary["short_bal"] = round(curr_s, 2)
                    market_summary["short_chg"] = round(curr_s - prev_s, 2)

    dt_map = {}
    dt_df = fetch_finmind("TaiwanStockDayTrading", start_date=latest_date, end_date=latest_date)
    if not dt_df.empty:
        for _, r in dt_df.iterrows():
            code = str(r.get("stock_id", "")).strip()
            if code in stocks_map:
                dt_lots = sfloat(r.get("Volume")) / 1000.0
                v_tot = stocks_map[code]["v"]
                dt_map[code] = round(dt_lots / v_tot * 100, 2) if v_tot > 0 else 0.0

    m_top_liq = existing_data.get("m_top_liq", [])
    m_bot_liq = existing_data.get("m_bot_liq", [])

    cur_ym = latest_date[:7]
    prev_ym_dates = [d for d in all_dates if d[:7] < cur_ym]
    if prev_ym_dates:
        prev_month_end = prev_ym_dates[-1]
        prev_ym = prev_month_end[:7]
        prev2_dates = [d for d in all_dates if d[:7] < prev_ym]
        prev2_month_end = prev2_dates[-1] if prev2_dates else ""
        prev3_ym = prev2_month_end[:7] if prev2_month_end else ""
        prev3_dates = [d for d in all_dates if prev3_ym and d[:7] < prev3_ym]
        prev3_month_end = prev3_dates[-1] if prev3_dates else ""

        df_m0 = fetch_finmind("TaiwanStockPrice", start_date=prev_month_end, end_date=prev_month_end)
        df_m1 = fetch_finmind("TaiwanStockPrice", start_date=prev2_month_end, end_date=prev2_month_end) if prev2_month_end else pd.DataFrame()
        df_m2 = fetch_finmind("TaiwanStockPrice", start_date=prev3_month_end, end_date=prev3_month_end) if prev3_month_end else pd.DataFrame()

        if not df_m0.empty:
            p_m0 = dict(zip(df_m0["stock_id"], df_m0["close"]))
            p_m1 = dict(zip(df_m1["stock_id"], df_m1["close"])) if not df_m1.empty else {}
            p_m2 = dict(zip(df_m2["stock_id"], df_m2["close"])) if not df_m2.empty else {}

            month_calc_all = []
            for s in stocks_map.values():
                if s["amt_yi"] < 0.5:
                    continue
                c0 = float(p_m0.get(s["c"], 0))
                if c0 <= 0:
                    continue
                m_curr_ret = round((s["p"] - c0) / c0 * 100, 2)
                c1 = float(p_m1.get(s["c"], 0))
                c2 = float(p_m2.get(s["c"], 0))
                m_prev1_ret = round((c0 - c1) / c1 * 100, 2) if c1 > 0 else 0.0
                m_prev2_ret = round((c1 - c2) / c2 * 100, 2) if (c1 > 0 and c2 > 0) else 0.0
                month_calc_all.append({
                    "c": s["c"], "n": s["n"],
                    "m_prev2": m_prev2_ret, "m_prev1": m_prev1_ret,
                    "m_curr": m_curr_ret, "p": s["p"], "amt_yi": s["amt_yi"]
                })

            if len(month_calc_all) >= 20:
                gainers = [x for x in month_calc_all if x["m_curr"] > 0]
                losers = [x for x in month_calc_all if x["m_curr"] < 0]
                m_top_liq = sorted(gainers, key=lambda x: x["m_curr"], reverse=True)[:25]
                m_bot_liq = sorted(losers, key=lambda x: x["m_curr"])[:25]

    heavy_exclude = {"2330", "2317", "2454", "2412", "2308", "2382", "3045", "4904", "6505", "1301", "1303", "2002", "1216"}
    candidate_list = sorted(
        [
            s for s in stocks_map.values()
            if s["v"] > 1000 and s["amt_yi"] >= 0.5
            and not s["c"].startswith("28") and not s["c"].startswith("58")
            and s["c"] not in heavy_exclude
        ],
        key=lambda x: x["v"],
        reverse=True
    )
    scan_targets = candidate_list[:480]
    print(f"📊 流動性合格共 {len(candidate_list)} 檔，本次完整掃描 {len(scan_targets)} 檔...")

    actual_chip_date = ""
    for d_test in reversed(recent_5_days):
        probe_br = fetch_finmind("TaiwanStockTradingDailyReport", data_id=scan_targets[0]["c"], start_date=d_test)
        if not probe_br.empty:
            actual_chip_date = d_test
            print(f"✅ 分點明細連線成功！最新結算日: {actual_chip_date}")
            break

    v7_stocks = []
    if actual_chip_date:
        target_5_days = [d for d in recent_5_days if d <= actual_chip_date][-5:]
        for st in scan_targets:
            code, vol, close_p, open_p, chg_pct = st["c"], st["v"], st["p"], st["o"], st["chg"]
            p_hist = fetch_finmind("TaiwanStockPrice", data_id=code, start_date=d60_start, end_date=actual_chip_date)
            ma20, high60, vr5, ma_cnt = close_p, close_p, 1.0, 1
            if not p_hist.empty and len(p_hist) >= 5:
                p_hist = p_hist.sort_values("date")
                ma5 = float(p_hist["close"].tail(5).mean())
                ma20 = float(p_hist["close"].tail(20).mean())
                ma60 = float(p_hist["close"].tail(60).mean())
                high60 = float(p_hist["close"].tail(60).max())
                v5_avg = float(p_hist["Trading_Volume"].tail(5).mean()) / 1000.0
                vr5 = round(vol / v5_avg, 2) if v5_avg > 0 else 1.0
                ma_cnt = int(close_p > ma5) + int(close_p > ma20) + int(close_p > ma60)

            d60 = round((close_p - high60) / high60 * 100, 2) if high60 > 0 else 0.0
            vin = 1 if (vol > 500 and vr5 >= 2.0) else 0
            pin = 1 if (vr5 >= 1.5 and close_p > open_p and d60 >= -2.0) else 0

            day_frames = []
            for d in target_5_days:
                df_d = fetch_finmind("TaiwanStockTradingDailyReport", data_id=code, start_date=d)
                if not df_d.empty:
                    day_frames.append(df_d)
            if not day_frames:
                continue
            br_df = pd.concat(day_frames, ignore_index=True)
            br_df["net_lots"] = (br_df["buy"] - br_df["sell"]) / 1000.0

            br_1d = br_df[br_df["date"] == actual_chip_date].groupby("securities_trader_id")["net_lots"].sum()
            bb1, sb1 = int((br_1d > 0).sum()), int((br_1d < 0).sum())
            bd = bb1 - sb1
            d1 = round(bd / (bb1 + sb1) * 100, 2) if (bb1 + sb1) > 0 else 0.0

            sum_diff, sum_tot, mf_5d_sum, mfd = 0, 0, 0.0, 0.0
            for d in target_5_days:
                dbr = br_df[br_df["date"] == d].groupby("securities_trader_id")["net_lots"].sum()
                if dbr.empty:
                    continue
                bb, sb = int((dbr > 0).sum()), int((dbr < 0).sum())
                sum_diff += (bb - sb)
                sum_tot += (bb + sb)
                dmf = dbr[dbr > 0].nlargest(15).sum() + dbr[dbr < 0].nsmallest(15).sum()
                mf_5d_sum += dmf
                if d == actual_chip_date:
                    mfd = dmf
            d5 = round(sum_diff / sum_tot * 100, 2) if sum_tot > 0 else 0.0
            dd = round(d1 - d5, 2)
            mf1 = round(mfd / vol * 100, 2) if vol > 0 else 0.0
            mf5 = round(mf_5d_sum / max(vol * len(target_5_days), 1) * 100, 2)

            dt1 = dt_map.get(code, 0.0)
            m1 = margin_map.get(code, {}).get("m1", 0.0)
            mc = margin_map.get(code, {}).get("mc", 0)
            it5_amt = trust_5d_amt_map.get(code, 0)

            sd = 1 if (d1 > 20 and dd > 10) else 0
            sdt = 1 if (dt1 > 40) else 0
            sm = 1 if (m1 > 25 and mc > 0) else 0
            smf = 1 if (mf1 < -5 and mf5 < -3) else 0
            sit = 1 if (it5_amt < -20000) else 0
            bs = sd + sdt + sm + smf + sit

            sg = 1 if (mf5 > 3 and d1 < -15 and dd < -10 and 15 <= dt1 <= 40) else 0
            sit_buy = 1 if (it5_amt > 20000 and close_p >= ma20) else 0
            sms = 1 if (mc < 0 and close_p >= ma20) else 0
            sc = round(mf1 * 1.5 + mf5 * 2.0 - d1 * 0.5 - dd * 0.5 + (it5_amt / 50000.0), 2)

            if (sg == 1 or sit_buy == 1) and sms == 1:
                adv = "★波段首選：主力/投信轉佳+資減價穩（開盤打大）"
            elif sit_buy == 1:
                adv = "🏦投信真金認養：機構連買守成本（開盤可進場）"
            elif sg == 1:
                adv = "▲主力吸籌集中：分點籌碼轉佳（開盤可進場）"
            elif bs >= 2 and chg_pct >= -2.0:
                adv = "▼高檔籌碼惡化：打黑K首選 / 波段改尾盤"
            elif bs >= 2:
                adv = "▽籌碼惡化(已跌)：波段避開 / 勿追低空"
            elif chg_pct >= 3.0 and bs >= 1:
                adv = "⚡次級打黑K觀察：逆勢大漲＋單項籌碼過熱"
            elif bs == 1:
                adv = "△籌碼微幅轉差：波段延後尾盤觀察"
            elif sms == 1:
                adv = "◇資減價穩：浮額沉澱偏多觀察"
            else:
                adv = "－中性觀望"

            v7_stocks.append({
                "c": code, "n": st["n"], "p": close_p, "chg": chg_pct, "v": vol,
                "vr5": vr5, "vin": vin, "vtag": "🔥爆量點火" if vin else "－",
                "pin": pin, "ptag": "🏆帶量創高" if pin else "－",
                "ma_cnt": ma_cnt, "d60": d60,
                "bd": bd, "d1": d1, "d5": d5, "dd": dd, "sd": sd,
                "dt1": dt1, "dt5": dt1, "sdt": sdt,
                "m1": m1, "m5": m1, "sm": sm, "mc": mc,
                "mf1": mf1, "mf5": mf5, "smf": smf,
                "it5_amt": it5_amt, "sit": sit,
                "bs": bs, "sg": sg, "sit_buy": sit_buy, "sms": sms,
                "sc": sc, "adv": adv
            })

    sectors = existing_data.get("sectors", [])
    rev_name_map = {v["n"]: k for k, v in stocks_map.items()}
    if os.path.exists(SECTOR_MAP_PATH):
        try:
            with open(SECTOR_MAP_PATH, "r", encoding="utf-8") as f:
                s_map = json.load(f)
            new_sectors = []
            for sec in s_map:
                rets = [stocks_map[m.get("c") or rev_name_map.get(m.get("n"), "")]["chg"]
                        for m in sec["members"]
                        if (m.get("c") or rev_name_map.get(m.get("n"), "")) in stocks_map]
                if rets:
                    avg_d = round(sum(rets) / len(rets), 2)
                    new_sectors.append({"g": sec["g"], "n": sec["name"], "d": avg_d, "w": avg_d, "m": None, "q": None})
            if new_sectors:
                sectors = new_sectors
        except Exception:
            pass

    active_v7 = v7_stocks if len(v7_stocks) > 0 else existing_data.get("v7_stocks", [])
    v7_trade_date = actual_chip_date if len(v7_stocks) > 0 else existing_data.get("v7_trade_date", latest_date)

    sd_breakout = [
        {"c": x["c"], "n": x["n"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "p": x["p"], "ma5": x["p"], "amt_k": int(x["v"] * x["p"]), "ma20": x["p"]}
        for x in active_v7 if x.get("pin") == 1
    ][:25] or existing_data.get("sd_breakout", [])

    sd_vol_red = [
        {"c": x["c"], "n": x["n"], "v": x["v"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "open": x["p"], "p": x["p"], "amt_k": int(x["v"] * x["p"])}
        for x in active_v7 if x.get("vin") == 1 and x.get("chg", 0) > 3.0
    ][:25] or existing_data.get("sd_vol_red", [])

    payload = {
        "updated_at": now_tw.strftime("%Y-%m-%d %H:%M"),
        "trade_date": latest_date,
        "v7_trade_date": v7_trade_date,
        "market_summary": market_summary,
        "v7_stocks": active_v7,
        "m_top_all": m_top_liq,
        "m_top_liq": m_top_liq,
        "m_bot_liq": m_bot_liq,
        "sectors": sectors,
        "inst_top": inst_top,
        "it_streak": it_streak,
        "it_fresh": it_fresh,
        "sd_breakout": sd_breakout,
        "sd_vol_red": sd_vol_red,
        "sd_high3m": existing_data.get("sd_high3m", []),
        "sd_vol_drop": existing_data.get("sd_vol_drop", []),
        "sd_short": existing_data.get("sd_short", [])
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"🎉 更新完成！大盤基準日: {latest_date} | 籌碼基準日: {v7_trade_date} | 掃描檔數: {len(active_v7)}")

if __name__ == "__main__":
    main()
