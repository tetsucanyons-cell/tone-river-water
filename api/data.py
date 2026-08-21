"""
Vercel Serverless Function for Live River & Dam Data
"""

import os
import sys
import json
import re
import urllib.request
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta

# 川の防災情報 基本URL
KAWABOU_BASE = "https://www.river.go.jp/kawabou/file/files"
KAWABOU_SYSTEM = "https://www.river.go.jp/kawabou/file/system"

# 観測所定義
STATIONS = {
    "stg": {
        "yubara": {"name": "湯原（利根川）", "keyCd": "2128900400012", "isMain": True, "river": "利根川"},
        "tsukiyono": {"name": "月夜野橋（利根川）", "keyCd": "0256100400044", "isMain": False, "river": "利根川"},
        "kosode": {"name": "小袖橋/小出（赤谷川）", "keyCd": "2128900400009", "isMain": False, "river": "赤谷川"},
        "yujuku": {"name": "湯宿（赤谷川）", "keyCd": "2128900400070", "isMain": False, "river": "赤谷川"},
    },
    "dam": {
        "fujiwara": {"name": "藤原ダム", "keyCd": "2128900700003", "isMain": True, "river": "利根川"},
        "naramata": {"name": "奈良俣ダム", "keyCd": "2128900700002", "isMain": False, "river": "楢俣川"},
        "yagisawa": {"name": "矢木沢ダム", "keyCd": "2128900700001", "isMain": False, "river": "利根川"},
        "aimata": {"name": "相俣ダム", "keyCd": "2128900700004", "isMain": False, "river": "赤谷川"},
    },
    "rain": {
        "yubara_rn": {"name": "湯原雨量", "keyCd": "2128900100036", "isMain": True},
        "fujiwara_rn": {"name": "藤原雨量", "keyCd": "2128900100033", "isMain": False},
        "aimata_rn": {"name": "相俣雨量", "keyCd": "2128900100014", "isMain": False},
    }
}


def fetch_url_json(url, timeout=5):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.river.go.jp/"
        }
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_latest_time_path():
    try:
        data = fetch_url_json(f"{KAWABOU_SYSTEM}/tmCrntTime.json")
        crnt_time = data.get("crntObsTime", "")
        nums = re.findall(r"\d+", crnt_time)
        if len(nums) >= 5:
            year, month, day, hour, minute = [int(x) for x in nums[:5]]
            m_round = (minute // 10) * 10
            return f"{year:04d}{month:02d}{day:02d}/{hour:02d}{m_round:02d}/", f"{year:04d}/{month:02d}/{day:02d} {hour:02d}:{m_round:02d}"
    except Exception as e:
        print(f"Error fetching tmCrntTime: {e}")
        
    jst = timezone(timedelta(hours=9))
    now = datetime.now(jst)
    m_round = (now.minute // 10) * 10
    return now.strftime(f"%Y%m%d/%H{m_round:02d}/"), now.strftime(f"%Y/%m/%d %H:{m_round:02d}")


def fetch_live_data():
    time_path, latest_time_str = get_latest_time_path()
    
    result = {
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
        "latest_obs_time": latest_time_str,
        "time_path": time_path,
        "stations": { "stg": {}, "dam": {}, "rain": {} },
        "main_combined_timeline": [],
        "weather": None
    }
    
    # 水位
    for key, info in STATIONS["stg"].items():
        try:
            raw = fetch_url_json(f"{KAWABOU_BASE}/tmlist/stg/{time_path}{info['keyCd']}.json")
            result["stations"]["stg"][key] = {
                "name": info["name"], "river": info["river"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": raw.get("obsValue", {}), "min10Values": raw.get("min10Values", [])
            }
        except Exception:
            result["stations"]["stg"][key] = {
                "name": info["name"], "river": info["river"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": {}, "min10Values": []
            }
            
    # ダム
    for key, info in STATIONS["dam"].items():
        try:
            raw = fetch_url_json(f"{KAWABOU_BASE}/tmlist/dam/{time_path}{info['keyCd']}.json")
            result["stations"]["dam"][key] = {
                "name": info["name"], "river": info["river"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": raw.get("obsValue", {}), "min10Values": raw.get("min10Values", [])
            }
        except Exception:
            result["stations"]["dam"][key] = {
                "name": info["name"], "river": info["river"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": {}, "min10Values": []
            }

    # 雨量
    for key, info in STATIONS["rain"].items():
        try:
            raw = fetch_url_json(f"{KAWABOU_BASE}/tmlist/rn/{time_path}{info['keyCd']}.json")
            result["stations"]["rain"][key] = {
                "name": info["name"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": raw.get("obsValue", {}), "min10Values": raw.get("min10Values", [])
            }
        except Exception:
            result["stations"]["rain"][key] = {
                "name": info["name"], "keyCd": info["keyCd"], "isMain": info["isMain"],
                "current": {}, "min10Values": []
            }

    # タイムライン結合
    yubara_stg_list = result["stations"]["stg"].get("yubara", {}).get("min10Values", [])
    fujiwara_dam_list = result["stations"]["dam"].get("fujiwara", {}).get("min10Values", [])
    yubara_rn_list = result["stations"]["rain"].get("yubara_rn", {}).get("min10Values", [])
    
    dam_map = {item.get("obsTime"): item for item in fujiwara_dam_list if "obsTime" in item}
    rn_map = {item.get("obsTime"): item for item in yubara_rn_list if "obsTime" in item}
    
    combined_rows = []
    for stg_item in yubara_stg_list:
        t = stg_item.get("obsTime")
        if not t:
            continue
        dam_item = dam_map.get(t, {})
        rn_item = rn_map.get(t, {})
        
        combined_rows.append({
            "obsTime": t,
            "stg": stg_item.get("stg"),
            "stg10mChg": stg_item.get("stg10mChg"),
            "stgHght": stg_item.get("stgHght"),
            "damDischarge": dam_item.get("allDisch"),
            "damInflow": dam_item.get("allSink"),
            "damStorageRate": dam_item.get("storPcntIrr"),
            "damStorageLvl": dam_item.get("storLvl"),
            "rain10m": rn_item.get("rn10m"),
            "rainInc": rn_item.get("rnInc")
        })
        
    result["main_combined_timeline"] = combined_rows

    # 天気
    try:
        url = "https://api.open-meteo.com/v1/forecast?latitude=36.768&longitude=138.971&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&timezone=Asia%2FTokyo&forecast_days=2"
        result["weather"] = fetch_url_json(url, timeout=3)
    except Exception:
        pass
        
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = fetch_live_data()
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
