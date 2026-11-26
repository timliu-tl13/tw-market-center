import os
import sys
import json
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "").strip()
TG_CHAT_ID = os.environ.get("TG_CHAT_ID", "").strip()
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


def get_today_ohlc():
    prices = {}
    try:
        r1 = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", timeout=15, verify=False).json()
        for item in r1:
            c = str(item.get("Code", "")).strip()
            prices[c] = {
                "o": float(str(item.get("OpeningPrice", 0)).replace(",", "") or 0),
                "c": float(str(item.get("ClosingPrice", 0)).replace(",", "") or 0),
                "chg": str(item.get("Change", "0")).strip()
            }
    except Exception:
        pass
    try:
        r2 = requests.get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", timeout=15, verify=False).json()
        for item in r2:
            c = str(item.get("SecuritiesCompanyCode", "")).strip()
            prices[c] = {
                "o": float(str(item.get("Open", 0)).replace(",", "") or 0),
                "c": float(str(item.get("Close", 0)).replace(",", "") or 0),
                "chg": str(item.get("Change", "0")).strip()
            }
    except Exception:
        pass
    return prices


def run_night_picks():
    """晚上 23:00：推播明日打黑K首選名單，並存檔供隔日下午驗證"""
    if not os.path.exists(DATA_PATH):
        return
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    chip_date = data.get("v7_trade_date", data.get("trade_date", ""))
    v7 = data.get("v7_stocks", [])

    # 篩選打黑K首選（惡化分 >= 2 且未重挫 chg >= -2%），依惡化分由高到低
    prime_list = sorted(
        [s for s in v7 if s.get("bs", 0) >= 2 and s.get("chg", 0) >= -2.0],
        key=lambda x: (-x.get("bs", 0), x.get("sc", 0))
    )[:12]

    # 儲存今日推薦清單到歷史紀錄檔，供隔日下午盤後核對
    history = {}
    if os.path.exists(HISTORY_PATH):
        try:
            with open(HISTORY_PATH, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = {}

    history[chip_date] = [{"c": s["c"], "n": s["n"], "bs": s["bs"], "prev_c": s["p"]} for s in prime_list]
    # 僅保留最近 30 個交易日紀錄
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
        lines.append(f"{idx}. <b>{s['c']} {s['n']}</b>｜{s['p']} ({s['chg']:+.2f}%)\n   └ 惡化 <b>{s['bs']}分</b> [{tag_str}]")

    lines.append("──────────────────")
    lines.append("💡 明日下午 16:30 將自動統計本批標的收黑K勝率")
    send_telegram("\n".join(lines))


def run_afternoon_verify():
    """下午 16:30：核對昨夜推播的打黑K首選今日是否收黑K（收盤 < 開盤），並統計勝率"""
    if not os.path.exists(HISTORY_PATH):
        print("⚠️ 尚無歷史推播紀錄可驗證。")
        return
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        history = json.load(f)
    if not history:
        return

    latest_pick_date = sorted(history.keys())[-1]
    picks = history[latest_pick_date]
    if not picks:
        return

    prices = get_today_ohlc()
    if len(prices) < 500:
        print("⚠️ 今日盤後報價尚未完整，稍後再驗證。")
        return

    win_cnt = 0
    valid_cnt = 0
    detail_lines = []

    for item in picks:
        c = item["c"]
        n = item["n"]
        bs = item["bs"]
        p_info = prices.get(c)
        if not p_info or p_info["o"] <= 0 or p_info["c"] <= 0:
            continue
        valid_cnt += 1
        op, cp = p_info["o"], p_info["c"]
        k_diff_pct = (cp - op) / op * 100.0
        # 收黑K判定：收盤價 < 開盤價（開高走低或開低走低）
        is_black_k = cp < op
        if is_black_k:
            win_cnt += 1
            icon = "✅ 真黑K"
        else:
            icon = "❌ 收紅/平"
        detail_lines.append(f"{icon} <b>{c} {n}</b> ({bs}分)\n   └ 開 {op} → 收 {cp} (實體 {k_diff_pct:+.2f}%)")

    if valid_cnt == 0:
        return

    win_rate = round(win_cnt / valid_cnt * 100, 1)
    warn_note = "\n⚠️ <b>勝率低於 50%，建議調高籌碼發散或當沖門檻！</b>" if win_rate < 50 else "\n🔥 <b>策略勝率穩定，維持現行參數！</b>"

    msg = "\n".join([
        f"📊 <b>【盤後驗收｜打黑K首選勝率統計】</b>",
        f"🎯 追蹤名單日：<code>{latest_pick_date}</code>",
        f"🏆 今日實戰勝率：<b>{win_cnt} / {valid_cnt} 檔（{win_rate}%）</b>",
        "──────────────────",
        *detail_lines,
        "──────────────────",
        warn_note.strip()
    ])
    send_telegram(msg)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "night"
    if mode == "verify":
        run_afternoon_verify()
    else:
        run_night_picks()
