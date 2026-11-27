import os
import sys
import json
from datetime import datetime, timedelta
import requests
import pandas as pd

TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "").strip()
TG_CHAT_ID = os.environ.get("TG_CHAT_ID", "").strip()
FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()
FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
DATA_PATH = "public/market_dashboard_data.json"
HISTORY_PATH = "public/black_k_history.json"


def send_telegram(text):
    if not TG_BOT_TOKEN or not TG_CHAT_ID:
        print("⚠️ 尚未設定 TG_BOT_TOKEN 或 TG_CHAT_ID，跳過發送。")
        return
    url = f"https://api.telegram.org/bot{TG_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TG_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    resp = requests.post(url, json=payload, timeout=15)
    if resp.status_code == 200:
        print("✅ Telegram 訊息發送成功！")
    else:
        print(f"❌ Telegram 發送失敗: {resp.text}")


def get_finmind_today_ohlc():
    """直接向 FinMind 取得最新交易日全市場開盤價、收盤價與漲跌幅"""
    now_tw = datetime.utcnow() + timedelta(hours=8)
    start_str = (now_tw - timedelta(days=10)).strftime("%Y-%m-%d")
    end_str = now_tw.strftime("%Y-%m-%d")

    params_cal = {"dataset": "TaiwanStockPrice", "data_id": "2330", "start_date": start_str, "end_date": end_str}
    if FINMIND_TOKEN:
        params_cal["token"] = FINMIND_TOKEN

    latest_date = ""
    try:
        r_cal = requests.get(FINMIND_URL, params=params_cal, timeout=20).json()
        if r_cal.get("msg") == "success" and r_cal.get("data"):
            latest_date = sorted(list(set(x["date"] for x in r_cal["data"])))[-1]
    except Exception:
        pass

    if not latest_date:
        return "", {}

    params_all = {"dataset": "TaiwanStockPrice", "start_date": latest_date, "end_date": latest_date}
    if FINMIND_TOKEN:
        params_all["token"] = FINMIND_TOKEN

    prices = {}
    try:
        r_all = requests.get(FINMIND_URL, params=params_all, timeout=30).json()
        if r_all.get("msg") == "success" and r_all.get("data"):
            for row in r_all["data"]:
                c = str(row.get("stock_id", "")).strip()
                op = float(row.get("open", 0) or 0)
                cp = float(row.get("close", 0) or 0)
                sp = float(row.get("spread", 0) or 0)
                prev_c = cp - sp
                chg_pct = round(sp / prev_c * 100, 2) if prev_c > 0 else 0.0
                if cp > 0:
                    prices[c] = {"o": op, "c": cp, "chg": chg_pct}
    except Exception:
        pass

    return latest_date, prices


def run_night_picks():
    """晚上 23:00：推播明日打黑K首選名單，並存檔供隔日下午驗證"""
    if not os.path.exists(DATA_PATH):
        return
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    chip_date = data.get("v7_trade_date", data.get("trade_date", ""))
    v7 = data.get("v7_stocks", [])

    prime_list = sorted(
        [s for s in v7 if s.get("bs", 0) >= 2 and s.get("chg", 0) >= -2.0],
        key=lambda x: (-x.get("bs", 0), x.get("sc", 0))
    )[:12]

    history = {}
    if os.path.exists(HISTORY_PATH):
        try:
            with open(HISTORY_PATH, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = {}

    history[chip_date] = [{"c": s["c"], "n": s["n"], "bs": s["bs"], "prev_c": s["p"]} for s in prime_list]
    for old_k in sorted(history.keys())[:-30]:
        history.pop(old_k, None)
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

    if not prime_list:
        msg = f"🌙 <b>【台股戰情室｜明日打黑K首選】</b>\n📅 籌碼基準日：{chip_date}\n\n今日無符合高檔籌碼惡化（≥2分）之標的。"
        send_telegram(msg)
        return

    lines = [
        f"🌙 <b>【台股戰情室｜明日打黑K首選】</b>",
        f"📅 籌碼基準日：<code>{chip_date}</code>（共 {len(prime_list)} 檔）",
        "──────────────────"
    ]
    for idx, s in enumerate(prime_list, 1):
        tags = []
        if s.get("sd"): tags.append("發散")
        if s.get("sdt"): tags.append("當沖熱")
        if s.get("sm"): tags.append("融資增")
        if s.get("smf"): tags.append("主力倒")
        if s.get("sit"): tags.append("投信賣")
        tag_str = "/".join(tags)
        lines.append(f"{idx}. <b>{s['c']} {s['n']}</b>｜收 {s['p']} ({s['chg']:+.2f}%)\n   └ 惡化 <b>{s['bs']}分</b> [{tag_str}]")

    lines.append("──────────────────")
    lines.append("💡 明日下午 16:30 將自動統計本批標的收黑K成功率")
    send_telegram("\n".join(lines))


def run_afternoon_verify():
    """下午 16:30：核對篩選出的打黑K首選今日收盤價、漲跌幅，並統計 黑K數/標的數 與成功率"""
    if not os.path.exists(HISTORY_PATH):
        print("⚠️ 尚無歷史推播紀錄可驗證。")
        return
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        history = json.load(f)
    if not history:
        return

    latest_date, prices = get_finmind_today_ohlc()
    if len(prices) < 500:
        print("⚠️ FinMind 今日盤後報價尚未完整，稍後再驗證。")
        return

    past_dates = [d for d in sorted(history.keys()) if d < latest_date]
    target_pick_date = past_dates[-1] if past_dates else sorted(history.keys())[-1]
    picks = history[target_pick_date]
    if not picks:
        return

    black_k_cnt = 0
    total_cnt = 0
    detail_lines = []

    for item in picks:
        c = item["c"]
        n = item["n"]
        bs = item["bs"]
        p_info = prices.get(c)
        if not p_info or p_info["o"] <= 0 or p_info["c"] <= 0:
            continue
        total_cnt += 1
        op, cp, chg_pct = p_info["o"], p_info["c"], p_info["chg"]
        is_black_k = cp < op
        if is_black_k:
            black_k_cnt += 1
            icon = "🖤 黑K"
        else:
            icon = "❤️ 紅/平"
        detail_lines.append(
            f"{icon} <b>{c} {n}</b> ({bs}分)\n"
            f"   └ 收盤 <b>{cp:.2f}</b>｜漲跌幅 <b>{chg_pct:+.2f}%</b>（開 {op:.2f}）"
        )

    if total_cnt == 0:
        return

    win_rate = round(black_k_cnt / total_cnt * 100, 1)
    warn_note = "⚠️ 成功率低於 50%，建議調高籌碼發散或當沖門檻！" if win_rate < 50 else "🔥 成功率穩定，維持現行篩選標準！"

    msg = "\n".join([
        f"📊 <b>【盤後驗收｜打黑K首選成功率統計】</b>",
        f"📅 驗證交易日：<code>{latest_date}</code>（名單基準：{target_pick_date}）",
        "──────────────────",
        *detail_lines,
        "──────────────────",
        f"🎯 <b>總結：黑K數 / 標的數 ＝ {black_k_cnt} / {total_cnt} 檔</b>",
        f"🏆 <b>當日黑K成功率：{win_rate}%</b>",
        warn_note
    ])
    send_telegram(msg)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "night"
    if mode == "verify":
        run_afternoon_verify()
    else:
        run_night_picks()
