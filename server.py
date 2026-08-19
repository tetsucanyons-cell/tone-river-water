"""
利根川水系（みなかみエリア）ラフティング向け リアルタイム水位・ダム情報配信サーバー
川の防災情報（国土交通省）の10分間隔データおよび気象データを取得・集約してWeb UIへ配信
"""

import sys
import os
import json
import time
import re
import urllib.request
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from threading import Thread, Lock

# サーバー設定
PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# 川の防災情報 基本URL
KAWABOU_BASE = "https://www.river.go.jp/kawabou/file/files"
KAWABOU_SYSTEM = "https://www.river.go.jp/kawabou/file/system"

# 観測所定義
STATIONS = {
    # 水位計 (itmkndCd = 4)
    "stg": {
        "yubara": {"name": "湯原（利根川）", "keyCd": "2128900400012", "isMain": True, "river": "利根川", "type": "stg"},
        "tsukiyono": {"name": "月夜野橋（利根川）", "keyCd": "0256100400044", "isMain": False, "river": "利根川", "type": "stg"},
        "kosode": {"name": "小袖橋/小出（赤谷川）", "keyCd": "2128900400009", "isMain": False, "river": "赤谷川", "type": "stg"},
        "yujuku": {"name": "湯宿（赤谷川）", "keyCd": "2128900400070", "isMain": False, "river": "赤谷川", "type": "stg"},
    },
    # ダム (itmkndCd = 7)
    "dam": {
        "fujiwara": {"name": "藤原ダム", "keyCd": "2128900700003", "isMain": True, "river": "利根川", "type": "dam"},
        "naramata": {"name": "奈良俣ダム", "keyCd": "2128900700002", "isMain": False, "river": "楢俣川", "type": "dam"},
        "yagisawa": {"name": "矢木沢ダム", "keyCd": "2128900700001", "isMain": False, "river": "利根川", "type": "dam"},
        "aimata": {"name": "相俣ダム", "keyCd": "2128900700004", "isMain": False, "river": "赤谷川", "type": "dam"},
    },
    # 雨量 (itmkndCd = 1)
    "rain": {
        "yubara_rn": {"name": "湯原雨量", "keyCd": "2128900100036", "isMain": True, "type": "rain"},
        "fujiwara_rn": {"name": "藤原雨量", "keyCd": "2128900100033", "isMain": False, "type": "rain"},
        "aimata_rn": {"name": "相俣雨量", "keyCd": "2128900100014", "isMain": False, "type": "rain"},
    }
}

# キャッシュ管理
data_cache = {
    "last_fetched": 0,
    "data": None
}
cache_lock = Lock()
CACHE_TTL_SECONDS = 30  # 30秒間キャッシュ


def fetch_url_json(url, timeout=7):
    """URLからJSONデータを取得"""
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
    """川の防災情報の最新観測時刻を取得してパス形式に整形"""
    try:
        data = fetch_url_json(f"{KAWABOU_SYSTEM}/tmCrntTime.json")
        crnt_time = data.get("crntObsTime", "")  # e.g. "2026/08/19 22:05"
        nums = re.findall(r"\d+", crnt_time)
        if len(nums) >= 5:
            year, month, day, hour, minute = [int(x) for x in nums[:5]]
            m_round = (minute // 10) * 10
            return f"{year:04d}{month:02d}{day:02d}/{hour:02d}{m_round:02d}/", f"{year:04d}/{month:02d}/{day:02d} {hour:02d}:{m_round:02d}"
    except Exception as e:
        print(f"[Warn] tmCrntTime fetch failed: {e}")
    
    # フォールバック: 現在JST時刻
    jst = timezone(timedelta(hours=9))
    now = datetime.now(jst)
    m_round = (now.minute // 10) * 10
    return now.strftime(f"%Y%m%d/%H{m_round:02d}/"), now.strftime(f"%Y/%m/%d %H:{m_round:02d}")


def fetch_weather_minakami():
    """みなかみ町の現在天気・予報を取得 (Open-Meteo API)"""
    try:
        # みなかみ町 湯原周辺 (緯度: 36.768, 経度: 138.971)
        url = "https://api.open-meteo.com/v1/forecast?latitude=36.768&longitude=138.971&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FTokyo&forecast_days=2"
        data = fetch_url_json(url, timeout=5)
        return data
    except Exception as e:
        print(f"[Warn] Weather fetch failed: {e}")
        return None


def fetch_all_river_data():
    """全観測所の最新10分データを取得・整形"""
    time_path, latest_time_str = get_latest_time_path()
    
    result = {
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
        "latest_obs_time": latest_time_str,
        "time_path": time_path,
        "stations": {
            "stg": {},
            "dam": {},
            "rain": {}
        },
        "main_combined_timeline": [],
        "weather": None
    }
    
    # 1. 水位計データ取得
    for key, info in STATIONS["stg"].items():
        url = f"{KAWABOU_BASE}/tmlist/stg/{time_path}{info['keyCd']}.json"
        try:
            raw = fetch_url_json(url)
            result["stations"]["stg"][key] = {
                "name": info["name"],
                "river": info["river"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": raw.get("obsValue", {}),
                "min10Values": raw.get("min10Values", [])
            }
        except Exception as e:
            print(f"[Error] Failed to fetch stg {key}: {e}")
            result["stations"]["stg"][key] = {
                "name": info["name"],
                "river": info["river"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": {},
                "min10Values": []
            }
            
    # 2. ダムデータ取得
    for key, info in STATIONS["dam"].items():
        url = f"{KAWABOU_BASE}/tmlist/dam/{time_path}{info['keyCd']}.json"
        try:
            raw = fetch_url_json(url)
            result["stations"]["dam"][key] = {
                "name": info["name"],
                "river": info["river"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": raw.get("obsValue", {}),
                "min10Values": raw.get("min10Values", [])
            }
        except Exception as e:
            print(f"[Error] Failed to fetch dam {key}: {e}")
            result["stations"]["dam"][key] = {
                "name": info["name"],
                "river": info["river"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": {},
                "min10Values": []
            }

    # 3. 雨量データ取得
    for key, info in STATIONS["rain"].items():
        url = f"{KAWABOU_BASE}/tmlist/rn/{time_path}{info['keyCd']}.json"
        try:
            raw = fetch_url_json(url)
            result["stations"]["rain"][key] = {
                "name": info["name"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": raw.get("obsValue", {}),
                "min10Values": raw.get("min10Values", [])
            }
        except Exception as e:
            print(f"[Error] Failed to fetch rain {key}: {e}")
            result["stations"]["rain"][key] = {
                "name": info["name"],
                "keyCd": info["keyCd"],
                "isMain": info["isMain"],
                "current": {},
                "min10Values": []
            }
            
    # 4. メイン統合タイムラインの作成 (湯原水位 + 藤原ダム放流量/流入量/貯水率 + 湯原雨量を10分刻み同一行で結合)
    yubara_stg_list = result["stations"]["stg"].get("yubara", {}).get("min10Values", [])
    fujiwara_dam_list = result["stations"]["dam"].get("fujiwara", {}).get("min10Values", [])
    yubara_rn_list = result["stations"]["rain"].get("yubara_rn", {}).get("min10Values", [])
    
    # 辞書マッピングを作成 (obsTime -> data)
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
            # 湯原水位データ
            "stg": stg_item.get("stg"),
            "stg10mChg": stg_item.get("stg10mChg"),
            "stgHght": stg_item.get("stgHght"),
            # 藤原ダムデータ
            "damDischarge": dam_item.get("allDisch"),       # 全放流量 (m3/s)
            "damInflow": dam_item.get("allSink"),           # 全流入量 (m3/s)
            "damStorageRate": dam_item.get("storPcntIrr"),  # 貯水率 (%)
            "damStorageLvl": dam_item.get("storLvl"),       # 貯水位 (m)
            # 雨量データ
            "rain10m": rn_item.get("rn10m"),                # 10分雨量 (mm)
            "rainInc": rn_item.get("rnInc")                 # 累計雨量 (mm)
        })
        
    result["main_combined_timeline"] = combined_rows

    # 5. 気象予報データ取得
    result["weather"] = fetch_weather_minakami()
    
    return result


def get_cached_river_data():
    """キャッシュ付きでデータを取得"""
    global data_cache
    now = time.time()
    with cache_lock:
        if data_cache["data"] is not None and (now - data_cache["last_fetched"]) < CACHE_TTL_SECONDS:
            return data_cache["data"]
            
    # キャッシュ切れ時は新たに取得
    fresh_data = fetch_all_river_data()
    with cache_lock:
        data_cache["last_fetched"] = time.time()
        data_cache["data"] = fresh_data
    return fresh_data


class AppRequestHandler(SimpleHTTPRequestHandler):
    """API & 静的ファイル配信ハンドラー"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)
        
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # APIエンドポイント
        if parsed.path == "/api/data" or parsed.path == "/api/latest":
            try:
                data = get_cached_river_data()
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                err_body = json.dumps({"error": str(e)}).encode("utf-8")
                self.wfile.write(err_body)
            return

        # ヘルスチェック
        if parsed.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return

        # 静的ファイル配信
        return super().do_GET()


def get_local_ip():
    """ローカルIPアドレスを取得"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def run_server():
    """サーバー起動"""
    local_ip = get_local_ip()
    print("=" * 60)
    print("  利根川水系 水位・ダム速報 アプリケーション")
    print("=" * 60)
    print(f"  [PC ブラウザ]   http://localhost:{PORT}")
    print(f"  [iPhone / スマホ] http://{local_ip}:{PORT}")
    print("  ※iPhoneと同じWi-Fiに接続してSafariで上記URLを開いてください")
    print("  ※Safariの「共有」ボタンから「ホーム画面に追加」でアプリ化できます")
    print("=" * 60)
    print(f"公開ディレクトリ: {PUBLIC_DIR}")
    print("データ取得先: 国土交通省 川の防災情報 (10分更新)")
    print("=" * 60)
    
    httpd = HTTPServer(("0.0.0.0", PORT), AppRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nサーバーを停止しました。")
        httpd.server_close()


if __name__ == "__main__":
    run_server()
