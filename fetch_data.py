"""
GitHub Actions 定期実行用データ更新スクリプト
川の防災情報・気象データを取得して data/latest.json に保存
"""

import os
import json
from datetime import datetime, timezone, timedelta
from server import fetch_all_river_data

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PUBLIC_DATA_DIR = os.path.join(BASE_DIR, "public", "data")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PUBLIC_DATA_DIR, exist_ok=True)

print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fetching latest river data...")
data = fetch_all_river_data()

# data/latest.json および public/data/latest.json に保存
for out_dir in [DATA_DIR, PUBLIC_DATA_DIR]:
    target_file = os.path.join(out_dir, "latest.json")
    with open(target_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Saved: {target_file}")

print("Data update completed successfully.")
