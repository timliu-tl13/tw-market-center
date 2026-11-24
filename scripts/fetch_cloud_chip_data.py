import os
import json
import time
from datetime import datetime, timedelta
import requests
import pandas as pd

FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "")
API_URL = "https://api.finmindtrade.com/api/v4/data"
OUTPUT_PATH = "public/market_dashboard_data.json"
SECTOR_MAP_PATH = "scripts/sector_mapping.json"

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
            resp = requests.get(API_URL, params=params, timeout=18)
            data = resp.json()
            if data.get("msg") == "success":
                return pd.DataFrame(data.get("data", []))
            if "limit" in str(data.get("msg", "")).lower():
                print("⚠️ 觸發每小時請求限制，暫停 60 秒...")
                time.sleep(60)
            else:
                return pd.DataFrame()
        except Exception:
            time.sleep(2)
    return pd.DataFrame()

def get_trading_dates(lookback_days=110):
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=lookback_days)
    df = fetch_finmind(
        "TaiwanStockPrice",
        data_id="2330",
        start_date=start_dt.strftime("%Y-%m-%d"),
        end_date=end_dt.strftime("%Y-%m-%d")
    )
    return sorted(df["date"].unique().tolist()) if not df.empty else []

def load_existing_json():
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def main():
    print("🚀 啟動台股多空戰情指揮中心全自動雲端爬蟲...")
    dates = get_trading_dates(110)
    if len(dates) < 25:
        print("❌ 無法取得足夠交易日曆，結束執行。")
        return

    latest_date = dates[-1]
    prev_date = dates[-2]
    d5_start = dates[-5]
    d20_start = dates[-20]
    d60_start = dates[-60] if len(dates) >= 60 else dates[0]
    print(f"📅 基準交易日: {latest_date} (前一交易日: {prev_date})")

    existing_data = load_existing_json()

    # ------------------------------------------------------------------
    # 0. 取得全市場股票基本資料（代號、名稱、上市/上櫃別）
    # ------------------------------------------------------------------
    info_df = fetch_finmind("TaiwanStockInfo", start_date=latest_date)
    name_map, type_map, rev_name_map = {}, {}, {}
    if not info_df.empty:
        info_df = info_df[info_df["type"].isin(["twse", "tpex"])].drop_duplicates(subset=["stock_id"])
        name_map = dict(zip(info_df["stock_id"], info_df["stock_name"]))
        type_map = dict(zip(info_df["stock_id"], info_df["type"]))
        rev_name_map = dict(zip(info_df["stock_name"], info_df["stock_id"]))

    # ------------------------------------------------------------------
    # 1. 首頁大盤戰情總覽（加權、櫃買、三大法人、融資餘額、全市場廣度）
    # ------------------------------------------------------------------
    market_summary = existing_data.get("market_summary", {})
    market_summary["trade_date"] = latest_date

    # 1A. 加權指數 (TAIEX)
    taiex_df = fetch_finmind("TaiwanStockTotalReturnIndex", data_id="TAIEX", start_date=d5_start, end_date=latest_date)
    if taiex_df.empty:
        taiex_df = fetch_finmind("TaiwanStockPrice", data_id="TAIEX", start_date=d5_start, end_date=latest_date)
    if not taiex_df.empty and len(taiex_df) >= 2:
        taiex_df = taiex_df.sort_values("date")
        c_col = "price" if "price" in taiex_df.columns else "close"
        cur_ix = float(taiex_df[c_col].iloc[-1])
        prv_ix = float(taiex_df[c_col].iloc[-2])
        market_summary["twse_index"] = round(cur_ix, 2)
        market_summary["twse_pts"] = round(cur_ix - prv_ix, 2)
        market_summary["twse_chg"] = round((cur_ix - prv_ix) / prv_ix * 100, 2) if prv_ix else 0.0

    # 1B. 櫃買指數 (TPEx) via TPEx OpenAPI
    try:
        tpex_resp = requests.get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_index", timeout=10).json()
        if isinstance(tpex_resp, list) and len(tpex_resp) > 0:
            last_tpex = tpex_resp[-1]
            t_close = float(str(last_tpex.get("Close", 0)).replace(",", ""))
            t_chg = float(str(last_tpex.get("Change", 0)).replace(",", ""))
            if t_close > 0:
                market_summary["tpex_index"] = round(t_close, 2)
                market_summary["tpex_pts"] = round(t_chg, 2)
                market_summary["tpex_chg"] = round(t_chg / (t_close - t_chg) * 100, 2)
    except Exception as e:
        print(f"⚠️ 櫃買指數 OpenAPI 略過: {e}")

    # 1C. 全市場當日行情與大盤成交金額 / 漲跌家數廣度
    market_df = fetch_finmind("TaiwanStockPrice", start_date=latest_date, end_date=latest_date)
    if market_df.empty:
        print("⚠️ 今日無收盤行情資料（假日或尚未结算），保留原有資料。")
        return

    market_df["vol_lots"] = market_df["Trading_Volume"] / 1000.0
    market_df["amt_yi"] = market_df["Trading_money"] / 1e8
    market_df["mkt_type"] = market_df["stock_id"].map(type_map)

    twse_amt = round(float(market_df[market_df["mkt_type"] == "twse"]["amt_yi"].sum()), 1)
    tpex_amt = round(float(market_df[market_df["mkt_type"] == "tpex"]["amt_yi"].sum()), 1)
    if twse_amt > 100:
        market_summary["twse_amt"] = twse_amt
    if tpex_amt > 50:
        market_summary["tpex_amt"] = tpex_amt

    reg_stocks = market_df[(market_df["stock_id"].str.len() == 4) & (~market_df["stock_id"].str.startswith("00"))].copy()
    tot_cnt = len(reg_stocks)
    if tot_cnt > 0:
        red_k = int((reg_stocks["close"] > reg_stocks["open"]).sum())
        black_k = int((reg_stocks["close"] < reg_stocks["open"]).sum())
        up_cnt = int((reg_stocks["spread"] > 0).sum())
        dn_cnt = int((reg_stocks["spread"] < 0).sum())
        market_summary["breadth"] = [
            {"name": "個股總數", "count": tot_cnt, "pct": 100.0},
            {"name": "當日紅K", "count": red_k, "pct": round(red_k / tot_cnt * 100, 2)},
            {"name": "當日黑K", "count": black_k, "pct": round(black_k / tot_cnt * 100, 2)},
            {"name": "當日上漲", "count": up_cnt, "pct": round(up_cnt / tot_cnt * 100, 2)},
            {"name": "當日下跌", "count": dn_cnt, "pct": round(dn_cnt / tot_cnt * 100, 2)},
        ]

    # ------------------------------------------------------------------
    # 2. 批量抓取全市場三大法人買賣超、當沖、融資融券（近 5 日）
    # ------------------------------------------------------------------
    inst_all = fetch_finmind("TaiwanStockInstitutionalInvestorsBuySell", start_date=d5_start, end_date=latest_date)
    dt_all = fetch_finmind("TaiwanStockDayTrading", start_date=d5_start, end_date=latest_date)
    margin_all = fetch_finmind("TaiwanStockMarginPurchaseShortSale", start_date=d5_start, end_date=latest_date)

    # 計算大盤三大法人買賣超金額（億元）與個股 TOP 10
    inst_top = existing_data.get("inst_top", {"foreign_buy": [], "foreign_sell": [], "trust_buy": [], "trust_sell": []})
    it_streak, it_fresh = [], []

    if not inst_all.empty:
        inst_all["net_shares"] = inst_all["buy"] - inst_all["sell"]
        inst_all["net_lots"] = inst_all["net_shares"] / 1000.0
        price_map_1d = dict(zip(market_df["stock_id"], market_df["close"]))
        inst_all["price"] = inst_all["stock_id"].map(price_map_1d).fillna(0.0)
        inst_all["net_yi"] = (inst_all["net_shares"] * inst_all["price"]) / 1e8

        inst_1d = inst_all[inst_all["date"] == latest_date].copy()
        f_1d = inst_1d[inst_1d["name"].str.contains("Foreign_Investor", na=False)]
        t_1d = inst_1d[inst_1d["name"] == "Investment_Trust"]
        d_1d = inst_1d[inst_1d["name"].str.contains("Dealer", na=False)]

        f_net = round(float(f_1d["net_yi"].sum()), 2)
        t_net = round(float(t_1d["net_yi"].sum()), 2)
        d_net = round(float(d_1d["net_yi"].sum()), 2)
        market_summary["foreign_net"] = f_net
        market_summary["trust_net"] = t_net
        market_summary["dealer_net"] = d_net
        market_summary["inst_total"] = round(f_net + t_net + d_net, 2)

        def build_top10(df_sub):
            df_sub = df_sub[df_sub["stock_id"].str.len() == 4].copy()
            df_sub["mkt"] = df_sub["stock_id"].map(type_map)
            df_sub["sname"] = df_sub["stock_id"].map(name_map).fillna(df_sub["stock_id"])
            twse_b = df_sub[df_sub["mkt"] == "twse"].sort_values("net_lots", ascending=False).head(10).reset_index(drop=True)
            tpex_b = df_sub[df_sub["mkt"] == "tpex"].sort_values("net_lots", ascending=False).head(10).reset_index(drop=True)
            twse_s = df_sub[df_sub["mkt"] == "twse"].sort_values("net_lots", ascending=True).head(10).reset_index(drop=True)
            tpex_s = df_sub[df_sub["mkt"] == "tpex"].sort_values("net_lots", ascending=True).head(10).reset_index(drop=True)
            buy_list, sell_list = [], []
            for i in range(10):
                buy_list.append({
                    "twse_n": twse_b.loc[i, "sname"] if i < len(twse_b) else "-",
                    "twse_v": int(round(twse_b.loc[i, "net_lots"])) if i < len(twse_b) else 0,
                    "tpex_n": tpex_b.loc[i, "sname"] if i < len(tpex_b) else "-",
                    "tpex_v": int(round(tpex_b.loc[i, "net_lots"])) if i < len(tpex_b) else 0,
                })
                sell_list.append({
                    "twse_n": twse_s.loc[i, "sname"] if i < len(twse_s) else "-",
                    "twse_v": int(round(twse_s.loc[i, "net_lots"])) if i < len(twse_s) else 0,
                    "tpex_n": tpex_s.loc[i, "sname"] if i < len(tpex_s) else "-",
                    "tpex_v": int(round(tpex_s.loc[i, "net_lots"])) if i < len(tpex_s) else 0,
                })
            return buy_list, sell_list

        inst_top["foreign_buy"], inst_top["foreign_sell"] = build_top10(f_1d)
        inst_top["trust_buy"], inst_top["trust_sell"] = build_top10(t_1d)

        # 投信連買 & 投信剛買
        t_all = inst_all[inst_all["name"] == "Investment_Trust"].copy()
        for code, grp in t_all.groupby("stock_id"):
            if len(code) != 4 or code.startswith("00"):
                continue
            grp = grp.sort_values("date")
            if grp["date"].iloc[-1] != latest_date:
                continue
            today_lots = float(grp["net_lots"].iloc[-1])
            if today_lots <= 20:
                continue
            streak = 0
            for val in reversed(grp["net_lots"].tolist()):
                if val > 0:
                    streak += 1
                else:
                    break
            stk_row = reg_stocks[reg_stocks["stock_id"] == code]
            if stk_row.empty:
                continue
            cp = float(stk_row["close"].iloc[0])
            sp = float(stk_row["spread"].iloc[0])
            chg = round(sp / (cp - sp) * 100, 2) if (cp - sp) > 0 else 0.0
            vol_l = int(stk_row["vol_lots"].iloc[0])
            item = {
                "c": code, "n": name_map.get(code, code), "p": cp, "chg": chg,
                "days": streak, "lots": round(today_lots, 1),
                "hold": 0.0, "cap_r": round(today_lots / max(vol_l, 1) * 100, 2),
                "v": vol_l, "vr5": 1.0
            }
            if streak >= 2:
                it_streak.append(item)
            elif streak == 1:
                it_fresh.append(item)
        it_streak = sorted(it_streak, key=lambda x: (x["days"], x["lots"]), reverse=True)[:25]
        it_fresh = sorted(it_fresh, key=lambda x: x["lots"], reverse=True)[:25]

    # 大盤融資餘額更新
    if not margin_all.empty:
        m_1d = margin_all[margin_all["date"] == latest_date]
        if not m_1d.empty:
            p_map = dict(zip(market_df["stock_id"], market_df["close"]))
            m_1d = m_1d.copy()
            m_1d["cp"] = m_1d["stock_id"].map(p_map).fillna(0.0)
            m_bal_yi = round(float((m_1d["MarginPurchaseTodayBalance"] * 1000 * m_1d["cp"]).sum()) / 1e8, 1)
            m_chg_yi = round(float(((m_1d["MarginPurchaseTodayBalance"] - m_1d["MarginPurchaseYesterdayBalance"]) * 1000 * m_1d["cp"]).sum()) / 1e8, 1)
            if m_bal_yi > 500:
                market_summary["margin_bal"] = m_bal_yi
                market_summary["margin_chg"] = m_chg_yi

    # ------------------------------------------------------------------
    # 3. 飆股篩選 v7（流動性 > 1,000 張活躍股深度分點＋技術突破＋量能異動）
    # ------------------------------------------------------------------
    liquid_df = reg_stocks[reg_stocks["vol_lots"] > 1000].sort_values(by="vol_lots", ascending=False)
    max_stocks = 380 if FINMIND_TOKEN else 140
    target_df = liquid_df.head(max_stocks)
    print(f"📊 流動性合格共 {len(liquid_df)} 檔，深度解析前 {len(target_df)} 檔分點與技術指標...")

    v7_stocks = []
    daily_ret_map = {}
    for _, row in reg_stocks.iterrows():
        cp = float(row["close"])
        sp = float(row["spread"])
        daily_ret_map[row["stock_id"]] = round(sp / (cp - sp) * 100, 2) if (cp - sp) > 0 else 0.0

    for _, row in target_df.iterrows():
        code = row["stock_id"]
        name = name_map.get(code, code)
        close_p = float(row["close"])
        open_p = float(row["open"])
        spread = float(row["spread"])
        prev_close = close_p - spread
        chg_pct = round((spread / prev_close * 100), 2) if prev_close > 0 else 0.0
        vol = int(row["vol_lots"])

        p_hist = fetch_finmind("TaiwanStockPrice", data_id=code, start_date=d60_start, end_date=latest_date)
        if p_hist.empty or len(p_hist) < 5:
            continue
        p_hist = p_hist.sort_values("date")
        ma5 = float(p_hist["close"].tail(5).mean())
        ma20 = float(p_hist["close"].tail(20).mean())
        ma60 = float(p_hist["close"].tail(60).mean())
        high60 = float(p_hist["close"].tail(60).max())
        vol_5d_avg = float(p_hist["Trading_Volume"].tail(5).mean()) / 1000.0
        vol_5d_sum = float(p_hist["Trading_Volume"].tail(5).sum()) / 1000.0
        vr5 = round(vol / vol_5d_avg, 2) if vol_5d_avg > 0 else 0.0

        ma_cnt = int(close_p > ma5) + int(close_p > ma20) + int(close_p > ma60)
        d60 = round((close_p - high60) / high60 * 100, 2) if high60 > 0 else 0.0
        vin = 1 if (vol > 500 and vr5 >= 2.0) else 0
        pin = 1 if (vr5 >= 1.5 and close_p > open_p and d60 >= -2.0) else 0

        # 當沖比
        dt_sub = dt_all[dt_all["stock_id"] == code] if not dt_all.empty else pd.DataFrame()
        dt_1d = float(dt_sub[dt_sub["date"] == latest_date]["Volume"].sum()) / 1000.0 if not dt_sub.empty else 0.0
        dt_5d = float(dt_sub["Volume"].sum()) / 1000.0 if not dt_sub.empty else 0.0
        dt1 = round(dt_1d / vol * 100, 2) if vol > 0 else 0.0
        dt5 = round(dt_5d / vol_5d_sum * 100, 2) if vol_5d_sum > 0 else 0.0

        # 融資使用率
        m_sub = margin_all[margin_all["stock_id"] == code].sort_values("date") if not margin_all.empty else pd.DataFrame()
        m1, m5, mc = 0.0, 0.0, 0
        if not m_sub.empty:
            m_sub = m_sub.copy()
            m_sub["ur"] = m_sub.apply(lambda x: float(x["MarginPurchaseTodayBalance"]) / float(x["MarginPurchaseLimit"]) * 100 if float(x["MarginPurchaseLimit"]) > 0 else 0.0, axis=1)
            lat_m = m_sub[m_sub["date"] == latest_date]
            if not lat_m.empty:
                m1 = round(float(lat_m["ur"].iloc[0]), 2)
                mc = int(float(lat_m["MarginPurchaseTodayBalance"].iloc[0]) - float(lat_m["MarginPurchaseYesterdayBalance"].iloc[0]))
            m5 = round(float(m_sub["ur"].mean()), 2)

        # 投信近5日買賣超金額(千)
        it5_amt = 0
        if not inst_all.empty:
            t_sub = inst_all[(inst_all["stock_id"] == code) & (inst_all["name"] == "Investment_Trust")]
            if not t_sub.empty:
                it5_amt = int(round(float(t_sub["net_shares"].sum()) * close_p / 1000.0))

        # 券商分點明細
        br_df = fetch_finmind("TaiwanStockTradingDailyReport", data_id=code, start_date=d5_start, end_date=latest_date)
        if br_df.empty:
            continue
        br_df["net_lots"] = (br_df["buy"] - br_df["sell"]) / 1000.0
        br_1d = br_df[br_df["date"] == latest_date].groupby("securities_trader_id")["net_lots"].sum()
        bb1, sb1 = int((br_1d > 0).sum()), int((br_1d < 0).sum())
        bd = bb1 - sb1
        d1 = round(bd / (bb1 + sb1) * 100, 2) if (bb1 + sb1) > 0 else 0.0

        sum_diff, sum_tot, mf_5d_sum, mfd = 0, 0, 0.0, 0
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
                mfd = int(round(dmf))

        d5 = round(sum_diff / sum_tot * 100, 2) if sum_tot > 0 else 0.0
        dd = round(d1 - d5, 2)
        mf1 = round(mfd / vol * 100, 2) if vol > 0 else 0.0
        mf5 = round(mf_5d_sum / vol_5d_sum * 100, 2) if vol_5d_sum > 0 else 0.0

        sd = 1 if (d1 > 20 and dd > 10) else 0
        sdt = 1 if (dt1 > 40 and (dt1 - dt5) > 10) else 0
        sm = 1 if (m1 > 25 and (m1 - m5) > 3) else 0
        smf = 1 if (mf1 < -5 and mf5 < -3) else 0
        sit = 1 if (it5_amt < -20000) else 0
        bs = sd + sdt + sm + smf + sit

        sg = 1 if (mf5 > 5 and d1 < -15 and dd < -10 and 15 <= dt1 <= 40) else 0
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
            "c": code, "n": name, "p": close_p, "chg": chg_pct, "v": vol,
            "vr5": vr5, "vin": vin, "vtag": "🔥爆量點火" if vin else "－",
            "pin": pin, "ptag": "🏆帶量創高" if pin else "－",
            "ma_cnt": ma_cnt, "d60": d60,
            "bd": bd, "d1": d1, "d5": d5, "dd": dd, "sd": sd,
            "dt1": dt1, "dt5": dt5, "sdt": sdt,
            "m1": m1, "m5": m5, "sm": sm, "mc": mc,
            "mf1": mf1, "mf5": mf5, "smf": smf,
            "it5_amt": it5_amt, "sit": sit,
            "bs": bs, "sg": sg, "sit_buy": sit_buy, "sms": sms,
            "sc": sc, "adv": adv
        })
        time.sleep(0.12)

    # ------------------------------------------------------------------
    # 4. 107 個自訂細產業類股漲跌幅（讀取 scripts/sector_mapping.json）
    # ------------------------------------------------------------------
    sectors = existing_data.get("sectors", [])
    if os.path.exists(SECTOR_MAP_PATH):
        try:
            with open(SECTOR_MAP_PATH, "r", encoding="utf-8") as f:
                s_map = json.load(f)
            new_sectors = []
            for sec in s_map:
                rets = []
                for m in sec["members"]:
                    cid = m.get("c") or rev_name_map.get(m.get("n"), "")
                    if cid in daily_ret_map:
                        rets.append(daily_ret_map[cid])
                if rets:
                    avg_d = round(sum(rets) / len(rets), 2)
                    new_sectors.append({
                        "g": sec["g"], "n": sec["name"],
                        "d": avg_d, "w": avg_d, "m": None, "q": None
                    })
            if new_sectors:
                sectors = new_sectors
        except Exception as e:
            print(f"⚠️ 細產業計算略過: {e}")

    # ------------------------------------------------------------------
    # 5. 當月漲跌幅排行（月漲幅 v2）
    # ------------------------------------------------------------------
    m_top_all = existing_data.get("m_top_all", [])
    m_top_liq = existing_data.get("m_top_liq", [])
    m_bot_liq = existing_data.get("m_bot_liq", [])
    cur_ym = latest_date[:7]
    month_dates = [d for d in dates if d.startswith(cur_ym)]
    if len(month_dates) >= 2:
        m_start_df = fetch_finmind("TaiwanStockPrice", start_date=month_dates[0], end_date=month_dates[0])
        if not m_start_df.empty:
            open_m_map = dict(zip(m_start_df["stock_id"], m_start_df["open"]))
            m_calc = []
            for _, row in reg_stocks.iterrows():
                cid = row["stock_id"]
                op_m = float(open_m_map.get(cid, 0))
                cp = float(row["close"])
                amt_yi = round(float(row["amt_yi"]), 2)
                if op_m > 0:
                    m_ret = round((cp - op_m) / op_m * 100, 2)
                    m_calc.append({
                        "c": cid, "n": name_map.get(cid, cid),
                        "m_prev2": 0.0, "m_prev1": 0.0, "m_curr": m_ret,
                        "p": cp, "amt_yi": amt_yi
                    })
            if m_calc:
                df_mc = pd.DataFrame(m_calc)
                m_top_all = df_mc.sort_values("m_curr", ascending=False).head(30).to_dict(orient="records")
                m_top_liq = df_mc[df_mc["amt_yi"] >= 0.5].sort_values("m_curr", ascending=False).head(30).to_dict(orient="records")
                m_bot_liq = df_mc[df_mc["amt_yi"] >= 0.5].sort_values("m_curr", ascending=True).head(25).to_dict(orient="records")

    # ------------------------------------------------------------------
    # 6. Select_D 技術型態清單（帶量突破、量增紅K、量增價跌）
    # ------------------------------------------------------------------
    sd_breakout = [
        {"c": x["c"], "n": x["n"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "p": x["p"], "ma5": x["p"], "amt_k": int(x["v"] * x["p"]), "ma20": x["p"]}
        for x in v7_stocks if x["pin"] == 1
    ][:25] or existing_data.get("sd_breakout", [])

    sd_vol_red = [
        {"c": x["c"], "n": x["n"], "v": x["v"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "open": x["p"], "p": x["p"], "amt_k": int(x["v"] * x["p"])}
        for x in v7_stocks if x["vin"] == 1 and x["chg"] > 3.0
    ][:25] or existing_data.get("sd_vol_red", [])

    sd_vol_drop = [
        {"c": x["c"], "n": x["n"], "v": x["v"], "vol_chg": round((x["vr5"] - 1) * 100, 1), "prev_p": x["p"], "p": x["p"]}
        for x in v7_stocks if x["vin"] == 1 and x["chg"] < -3.0
    ][:20] or existing_data.get("sd_vol_drop", [])

    # ------------------------------------------------------------------
    # 7. 寫出完整 market_dashboard_data.json
    # ------------------------------------------------------------------
    payload = {
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "trade_date": latest_date,
        "market_summary": market_summary,
        "v7_stocks": v7_stocks if v7_stocks else existing_data.get("v7_stocks", []),
        "m_top_all": m_top_all,
        "m_top_liq": m_top_liq,
        "m_bot_liq": m_bot_liq,
        "sectors": sectors,
        "inst_top": inst_top,
        "it_streak": it_streak if it_streak else existing_data.get("it_streak", []),
        "it_fresh": it_fresh if it_fresh else existing_data.get("it_fresh", []),
        "sd_breakout": sd_breakout,
        "sd_vol_red": sd_vol_red,
        "sd_high3m": existing_data.get("sd_high3m", []),
        "sd_vol_drop": sd_vol_drop,
        "sd_short": existing_data.get("sd_short", [])
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"✅ 全部更新完成！基準日: {latest_date}，v7 深度分析: {len(payload['v7_stocks'])} 檔")

if __name__ == "__main__":
    main()
