import os
import json
import time
from datetime import datetime, timedelta
import requests
import urllib3
import pandas as pd

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "")
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
    if end_date:
        params["end_date"] = end_date
    if FINMIND_TOKEN:
        params["token"] = FINMIND_TOKEN

    for _ in range(3):
        try:
            resp = requests.get(FINMIND_URL, params=params, timeout=18)
            data = resp.json()
            if data.get("msg") == "success":
                return pd.DataFrame(data.get("data", []))
            if "limit" in str(data.get("msg", "")).lower():
                print("⚠️ FinMind 達到每小時請求上限，暫停 60 秒...")
                time.sleep(60)
            else:
                return pd.DataFrame()
        except Exception:
            time.sleep(2)
    return pd.DataFrame()

def get_recent_trading_dates(lookback_days=110):
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=lookback_days)
    df = fetch_finmind(
        "TaiwanStockPrice",
        data_id="2330",
        start_date=start_dt.strftime("%Y-%m-%d"),
        end_date=end_dt.strftime("%Y-%m-%d")
    )
    if df.empty:
        return []
    return sorted(df["date"].unique().tolist())

def load_existing_json():
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def main():
    print("🚀 啟動台股多空戰情指揮中心全自動爬蟲...")
    dates = get_recent_trading_dates(110)
    if len(dates) < 20:
        print("❌ 無法取得交易日曆，保留舊資料不覆蓋。")
        return

    latest_date = dates[-1]
    d5_start = dates[-5]
    d60_start = dates[-60] if len(dates) >= 60 else dates[0]
    ymd = latest_date.replace("-", "")
    print(f"📅 偵測到最新交易日: {latest_date}")

    existing_data = load_existing_json()
    market_summary = existing_data.get("market_summary", {})
    market_summary["trade_date"] = latest_date

    # 1. 大盤加權、櫃買指數、三大法人金額
    fmtqik = get_json(f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={ymd}&response=json")
    if fmtqik and fmtqik.get("stat") == "OK" and fmtqik.get("data"):
        last_row = fmtqik["data"][-1]
        amt_yi = round(sfloat(last_row[2]) / 1e8, 1)
        idx_val = round(sfloat(last_row[4]), 2)
        pts_val = round(sfloat(last_row[5]), 2)
        prev_idx = idx_val - pts_val
        chg_val = round(pts_val / prev_idx * 100, 2) if prev_idx > 0 else 0.0
        if idx_val > 0:
            market_summary["twse_index"] = idx_val
            market_summary["twse_pts"] = pts_val
            market_summary["twse_chg"] = chg_val
            market_summary["twse_amt"] = amt_yi

    tpex_updated = False
    tpex_idx = get_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_index")
    if isinstance(tpex_idx, list) and len(tpex_idx) > 0:
        last_t = tpex_idx[-1]
        t_close = sfloat(last_t.get("Close") or last_t.get("Index") or last_t.get("收盤指數"))
        t_chg = sfloat(last_t.get("Change") or last_t.get("漲跌"))
        if t_close > 0:
            market_summary["tpex_index"] = round(t_close, 2)
            market_summary["tpex_pts"] = round(t_chg, 2)
            market_summary["tpex_chg"] = round(t_chg / (t_close - t_chg) * 100, 2) if (t_close - t_chg) > 0 else 0.0
            tpex_updated = True

    if not tpex_updated:
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

    bfi = get_json(f"https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate={ymd}&type=day&response=json")
    if bfi and bfi.get("stat") == "OK" and bfi.get("data"):
        f_net, t_net, d_net = 0.0, 0.0, 0.0
        for row in bfi["data"]:
            label = str(row[0]).strip()
            if "合計" in label:
                continue
            diff_yi = sfloat(row[3]) / 1e8
            if "外陸資" in label or "外資" in label:
                f_net += diff_yi
            elif "投信" in label:
                t_net += diff_yi
            elif "自營商" in label:
                d_net += diff_yi
        market_summary["foreign_net"] = round(f_net, 2)
        market_summary["trust_net"] = round(t_net, 2)
        market_summary["dealer_net"] = round(d_net, 2)
        market_summary["inst_total"] = round(f_net + t_net + d_net, 2)

    # 2. 全市場上市＋上櫃每日收盤行情（含當日均價 = 成交金額 / 成交股數）
    stocks_map = {}
    twse_all = get_json("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL")
    if isinstance(twse_all, list):
        for item in twse_all:
            code = str(item.get("Code", "")).strip()
            if len(code) != 4 or code.startswith("00"):
                continue
            cp = sfloat(item.get("ClosingPrice"))
            op = sfloat(item.get("OpeningPrice"))
            chg_p = sfloat(item.get("Change"))
            shares = sfloat(item.get("TradeVolume"))
            val_ntd = sfloat(item.get("TradeValue"))
            vol_lots = sint(shares / 1000.0)
            amt_yi = round(val_ntd / 1e8, 2)
            avg_p = round(val_ntd / shares, 2) if shares > 0 else cp
            prev_p = cp - chg_p
            chg_pct = round(chg_p / prev_p * 100, 2) if prev_p > 0 else 0.0
            if cp > 0:
                stocks_map[code] = {
                    "c": code, "n": str(item.get("Name", code)).strip(), "mkt": "twse",
                    "p": cp, "o": op, "avg_p": avg_p, "chg": chg_pct, "v": vol_lots, "amt_yi": amt_yi
                }

    tpex_all = get_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes")
    if isinstance(tpex_all, list):
        tpex_amt_sum = 0.0
        for item in tpex_all:
            code = str(item.get("SecuritiesCompanyCode", "")).strip()
            if len(code) != 4 or code.startswith("00"):
                continue
            cp = sfloat(item.get("Close"))
            op = sfloat(item.get("Open"))
            chg_p = sfloat(item.get("Change"))
            shares = sfloat(item.get("TradingShares"))
            val_ntd = sfloat(item.get("TransactionAmount"))
            vol_lots = sint(shares / 1000.0)
            amt_yi = round(val_ntd / 1e8, 2)
            avg_p = round(val_ntd / shares, 2) if shares > 0 else cp
            tpex_amt_sum += amt_yi
            prev_p = cp - chg_p
            chg_pct = round(chg_p / prev_p * 100, 2) if prev_p > 0 else 0.0
            if cp > 0:
                stocks_map[code] = {
                    "c": code, "n": str(item.get("CompanyName", code)).strip(), "mkt": "tpex",
                    "p": cp, "o": op, "avg_p": avg_p, "chg": chg_pct, "v": vol_lots, "amt_yi": amt_yi
                }
        if tpex_amt_sum > 50:
            market_summary["tpex_amt"] = round(tpex_amt_sum, 1)

    if len(stocks_map) < 500:
        print("⚠️ 證交所/櫃買收盤資料尚未完整結算，保留前一日完整數據。")
        return

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

    # 3. 外資與投信買賣超「金額」TOP 10（張數 × 當日均價，單位：億元）
    inst_top = existing_data.get("inst_top", {"foreign_buy": [], "foreign_sell": [], "trust_buy": [], "trust_sell": []})
    twse_f_amt, twse_t_amt, tpex_f_amt, tpex_t_amt = [], [], [], []
    trust_lots_map = {}

    t86 = get_json(f"https://www.twse.com.tw/rwd/zh/fund/T86?date={ymd}&selectType=ALLBUT0999&response=json")
    if t86 and t86.get("stat") == "OK" and t86.get("data"):
        for row in t86["data"]:
            code = str(row[0]).strip()
            if code not in stocks_map:
                continue
            st = stocks_map[code]
            f_lots = sfloat(row[4]) / 1000.0
            t_lots = sfloat(row[10]) / 1000.0
            f_yi = round(f_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            t_yi = round(t_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            twse_f_amt.append((st["n"], f_yi))
            twse_t_amt.append((st["n"], t_yi))
            trust_lots_map[code] = sint(t_lots)

    tpex_3i = get_json("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading")
    if isinstance(tpex_3i, list):
        for item in tpex_3i:
            code = str(item.get("SecuritiesCompanyCode", "")).strip()
            if code not in stocks_map:
                continue
            st = stocks_map[code]
            f_lots = sfloat(item.get("ForeignInvestorsDifference")) / 1000.0
            t_lots = sfloat(item.get("InvestmentTrustDifference")) / 1000.0
            f_yi = round(f_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            t_yi = round(t_lots * 1000.0 * st["avg_p"] / 1e8, 2)
            tpex_f_amt.append((st["n"], f_yi))
            tpex_t_amt.append((st["n"], t_yi))
            trust_lots_map[code] = sint(t_lots)

    if twse_f_amt:
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
    for code, t_lots in sorted(trust_lots_map.items(), key=lambda x: x[1] * stocks_map.get(x[0], {}).get("avg_p", 0), reverse=True):
        if t_lots >= 50 and code in stocks_map:
            st = stocks_map[code]
            it_fresh.append({
                "c": code, "n": st["n"], "p": st["p"], "chg": st["chg"],
                "days": 1, "lots": t_lots, "hold": 0.0,
                "cap_r": round(t_lots / max(st["v"], 1) * 100, 2),
                "v": st["v"], "vr5": 1.0
            })
        if len(it_fresh) >= 25:
            break

    # 4. 融資融券餘額 & 當沖比率
    margin_map = {}
    margn = get_json(f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={ymd}&selectType=ALL&response=json")
    if margn and margn.get("stat") == "OK":
        tables = margn.get("tables", [])
        if len(tables) >= 1 and tables[0].get("data"):
            for r in tables[0]["data"]:
                if "融資金額" in str(r[0]):
                    prev_m, curr_m = sfloat(r[4]) / 1e5, sfloat(r[5]) / 1e5
                    if curr_m > 500:
                        market_summary["margin_bal"] = round(curr_m, 1)
                        market_summary["margin_chg"] = round(curr_m - prev_m, 1)
                elif "融券" in str(r[0]):
                    curr_s, prev_s = sfloat(r[5]) / 1e4, sfloat(r[4]) / 1e4
                    if curr_s > 0:
                        market_summary["short_bal"] = round(curr_s, 2)
                        market_summary["short_chg"] = round(curr_s - prev_s, 2)
        if len(tables) >= 2 and tables[1].get("data"):
            for r in tables[1]["data"]:
                code = str(r[0]).strip()
                prev_b, curr_b, lim_b = sfloat(r[5]), sfloat(r[6]), sfloat(r[7])
                ur = round(curr_b / lim_b * 100, 2) if lim_b > 0 else 0.0
                margin_map[code] = {"m1": ur, "mc": sint(curr_b - prev_b)}

    tpex_mb = get_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance")
    if isinstance(tpex_mb, list):
        for item in tpex_mb:
            code = str(item.get("SecuritiesCompanyCode", "")).strip()
            prev_b = sfloat(item.get("MarginPurchaseYesterdayBalance"))
            curr_b = sfloat(item.get("MarginPurchaseTodayBalance"))
            lim_b = sfloat(item.get("MarginPurchaseLimit"))
            ur = round(curr_b / lim_b * 100, 2) if lim_b > 0 else 0.0
            margin_map[code] = {"m1": ur, "mc": sint(curr_b - prev_b)}

    dt_map = {}
    twtb4u = get_json(f"https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date={ymd}&response=json")
    if twtb4u and twtb4u.get("stat") == "OK":
        for tb in twtb4u.get("tables", []):
            if tb.get("data") and len(tb["data"]) > 20:
                for r in tb["data"]:
                    code = str(r[0]).strip()
                    if code in stocks_map:
                        dt_lots = sfloat(r[3]) / 1000.0
                        v_tot = stocks_map[code]["v"]
                        dt_map[code] = round(dt_lots / v_tot * 100, 2) if v_tot > 0 else 0.0

    tpex_dt = get_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_day_trading")
    if isinstance(tpex_dt, list):
        for item in tpex_dt:
            code = str(item.get("SecuritiesCompanyCode", "")).strip()
            if code in stocks_map:
                dt_lots = sfloat(item.get("DayTradingVolume")) / 1000.0
                v_tot = stocks_map[code]["v"]
                dt_map[code] = round(dt_lots / v_tot * 100, 2) if v_tot > 0 else 0.0

    # 5. 籌碼篩選（排除大型權值與金融股，專注動能飆股分點明細）
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
    max_scan = 180 if FINMIND_TOKEN else 80
    scan_targets = candidate_list[:max_scan]

    probe_code = scan_targets[0]["c"] if scan_targets else "2303"
    probe_br = fetch_finmind("TaiwanStockTradingDailyReport", data_id=probe_code, start_date=latest_date, end_date=latest_date)
    broker_ready = not probe_br.empty
    if not broker_ready:
        print(f"⚠️ FinMind 當日 ({latest_date}) 券商分點明細尚未結算，保留前一日籌碼篩選名單。")

    v7_stocks = []
    if broker_ready:
        for st in scan_targets:
            code, vol, close_p, open_p, chg_pct = st["c"], st["v"], st["p"], st["o"], st["chg"]
            p_hist = fetch_finmind("TaiwanStockPrice", data_id=code, start_date=d60_start, end_date=latest_date)
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

            br_df = fetch_finmind("TaiwanStockTradingDailyReport", data_id=code, start_date=d5_start, end_date=latest_date)
            if br_df.empty:
                continue
            br_df["net_lots"] = (br_df["buy"] - br_df["sell"]) / 1000.0
            br_1d = br_df[br_df["date"] == latest_date].groupby("securities_trader_id")["net_lots"].sum()
            bb1, sb1 = int((br_1d > 0).sum()), int((br_1d < 0).sum())
            bd = bb1 - sb1
            d1 = round(bd / (bb1 + sb1) * 100, 2) if (bb1 + sb1) > 0 else 0.0

            sum_diff, sum_tot, mf_5d_sum, mfd = 0, 0, 0.0, 0.0
            for d in dates[-5:]:
                dbr = br_df[br_df["date"] == d].groupby("securities_trader_id")["net_lots"].sum()
                if dbr.empty:
                    continue
                bb, sb = int((dbr > 0).sum()), int((dbr < 0).sum())
                sum_diff += (bb - sb)
                sum_tot += (bb + sb)
                dmf = dbr[dbr > 0].nlargest(15).sum() + dbr[dbr < 0].nsmallest(15).sum()
                mf_5d_sum += dmf
                if d == latest_date:
                    mfd = dmf
            d5 = round(sum_diff / sum_tot * 100, 2) if sum_tot > 0 else 0.0
            dd = round(d1 - d5, 2)
            mf1 = round(mfd / vol * 100, 2) if vol > 0 else 0.0
            mf5 = round(mf_5d_sum / max(vol * 5, 1) * 100, 2)

            dt1 = dt_map.get(code, 0.0)
            m1 = margin_map.get(code, {}).get("m1", 0.0)
            mc = margin_map.get(code, {}).get("mc", 0)
            t_lots = trust_lots_map.get(code, 0)
            it5_amt = int(round(t_lots * st["avg_p"]))

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
            time.sleep(0.1)

    # 6. 當月漲跌幅排行（強勢與弱勢皆嚴格過濾 成交值 > 5,000 萬 = 0.5 億）
    m_top_liq = existing_data.get("m_top_liq", [])
    m_bot_liq = existing_data.get("m_bot_liq", [])
    prev_m_map = {x["c"]: x for x in (m_top_liq + m_bot_liq)}
    m_updated = []
    for s in stocks_map.values():
        if s["amt_yi"] >= 0.5 and s["c"] in prev_m_map and prev_m_map[s["c"]]["p"] > 0:
            old = prev_m_map[s["c"]]
            base_p = old["p"] / (1 + old["m_curr"] / 100.0) if (1 + old["m_curr"] / 100.0) > 0 else s["p"]
            new_m = round((s["p"] - base_p) / base_p * 100, 2) if base_p > 0 else s["chg"]
            m_updated.append({
                "c": s["c"], "n": s["n"],
                "m_prev2": old.get("m_prev2", 0.0), "m_prev1": old.get("m_prev1", 0.0),
                "m_curr": new_m, "p": s["p"], "amt_yi": s["amt_yi"]
            })
    if len(m_updated) >= 15:
        m_top_liq = sorted(m_updated, key=lambda x: x["m_curr"], reverse=True)[:25]
        m_bot_liq = sorted(m_updated, key=lambda x: x["m_curr"])[:25]

    # 7. 細產業與技術突破
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

    active_v7 = v7_stocks if (broker_ready and len(v7_stocks) > 0) else existing_data.get("v7_stocks", [])
    v7_trade_date = latest_date if (broker_ready and len(v7_stocks) > 0) else existing_data.get("v7_trade_date", existing_data.get("trade_date", latest_date))

    sd_breakout = [
        {"c": x["c"], "n": x["n"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "p": x["p"], "ma5": x["p"], "amt_k": int(x["v"] * x["p"]), "ma20": x["p"]}
        for x in active_v7 if x.get("pin") == 1
    ][:25] or existing_data.get("sd_breakout", [])

    sd_vol_red = [
        {"c": x["c"], "n": x["n"], "v": x["v"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "open": x["p"], "p": x["p"], "amt_k": int(x["v"] * x["p"])}
        for x in active_v7 if x.get("vin") == 1 and x.get("chg", 0) > 3.0
    ][:25] or existing_data.get("sd_vol_red", [])

    payload = {
        "updated_at": (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M"),
        "trade_date": latest_date,
        "v7_trade_date": v7_trade_date,
        "market_summary": market_summary,
        "v7_stocks": active_v7,
        "m_top_all": m_top_liq,
        "m_top_liq": m_top_liq,
        "m_bot_liq": m_bot_liq,
        "sectors": sectors,
        "inst_top": inst_top,
        "it_streak": existing_data.get("it_streak", []),
        "it_fresh": it_fresh if it_fresh else existing_data.get("it_fresh", []),
        "sd_breakout": sd_breakout,
        "sd_vol_red": sd_vol_red,
        "sd_high3m": existing_data.get("sd_high3m", []),
        "sd_vol_drop": existing_data.get("sd_vol_drop", []),
        "sd_short": existing_data.get("sd_short", [])
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"🎉 更新完成！大盤基準日: {latest_date} | 籌碼基準日: {v7_trade_date}")

if __name__ == "__main__":
    main()
