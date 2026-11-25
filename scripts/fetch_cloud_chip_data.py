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
        params["token"] = FINMIND_
