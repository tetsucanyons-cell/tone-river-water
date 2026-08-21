"""
GitHub Actions & ローカル定期実行用データ蓄積スクリプト
1. 川の防災情報・気象データを取得して data/latest.json に保存
2. 10分詳細データを月別CSV (data/history/YYYY-MM.csv) に追記 (重複防止)
3. 日別集計 (最高・最低・平均水位、ダム貯水量/率) を data/history/daily_YYYY.json & .csv に集計・保存
"""

import os
import csv
import json
import re
from datetime import datetime, timezone, timedelta
from server import fetch_all_river_data

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")
PUBLIC_DATA_DIR = os.path.join(BASE_DIR, "public", "data")
PUBLIC_HISTORY_DIR = os.path.join(PUBLIC_DATA_DIR, "history")

for d in [DATA_DIR, HISTORY_DIR, PUBLIC_DATA_DIR, PUBLIC_HISTORY_DIR]:
    os.makedirs(d, exist_ok=True)

CSV_HEADERS = [
    "obsTime", "yubara_stg", "yubara_chg10m", "tsukiyono_stg", "kosode_stg", "yujuku_stg",
    "fujiwara_disch", "fujiwara_inflow", "fujiwara_stor_rate", "fujiwara_stor_cap", "fujiwara_stor_lvl",
    "naramata_disch", "naramata_stor_rate", "yagisawa_disch", "yagisawa_stor_rate",
    "aimata_disch", "aimata_stor_rate", "yubara_rn10m", "yubara_rn_inc"
]


def update_latest_json(data):
    """latest.json の保存"""
    for out_dir in [DATA_DIR, PUBLIC_DATA_DIR]:
        target_file = os.path.join(out_dir, "latest.json")
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def append_to_monthly_csv(data):
    """月別10分詳細CSVへの追記 (重複排除)"""
    timeline = data.get("main_combined_timeline", [])
    if not timeline:
        return

    stg_map = data.get("stations", {}).get("stg", {})
    dam_map = data.get("stations", {}).get("dam", {})
    rain_map = data.get("stations", {}).get("rain", {})

    # 観測所ごとの時刻マップ作成
    def make_time_map(station_obj, val_key):
        values = station_obj.get("min10Values", [])
        return {item.get("obsTime"): item.get(val_key) for item in values if "obsTime" in item}

    tsukiyono_stg = make_time_map(stg_map.get("tsukiyono", {}), "stg")
    kosode_stg = make_time_map(stg_map.get("kosode", {}), "stg")
    yujuku_stg = make_time_map(stg_map.get("yujuku", {}), "stg")

    naramata_disch = make_time_map(dam_map.get("naramata", {}), "allDisch")
    naramata_rate = make_time_map(dam_map.get("naramata", {}), "storPcntIrr")
    yagisawa_disch = make_time_map(dam_map.get("yagisawa", {}), "allDisch")
    yagisawa_rate = make_time_map(dam_map.get("yagisawa", {}), "storPcntIrr")
    aimata_disch = make_time_map(dam_map.get("aimata", {}), "allDisch")
    aimata_rate = make_time_map(dam_map.get("aimata", {}), "storPcntIrr")
    fujiwara_cap = make_time_map(dam_map.get("fujiwara", {}), "storCap")

    # 月ごとにグループ分け
    month_records = {}
    for row in timeline:
        t = row.get("obsTime", "")
        if not t or len(t) < 7:
            continue
        ym = t[:7].replace("/", "-")  # "2026-08"
        if ym not in month_records:
            month_records[ym] = []

        month_records[ym].append({
            "obsTime": t,
            "yubara_stg": row.get("stg", ""),
            "yubara_chg10m": row.get("stg10mChg", ""),
            "tsukiyono_stg": tsukiyono_stg.get(t, ""),
            "kosode_stg": kosode_stg.get(t, ""),
            "yujuku_stg": yujuku_stg.get(t, ""),
            "fujiwara_disch": row.get("damDischarge", ""),
            "fujiwara_inflow": row.get("damInflow", ""),
            "fujiwara_stor_rate": row.get("damStorageRate", ""),
            "fujiwara_stor_cap": fujiwara_cap.get(t, ""),
            "fujiwara_stor_lvl": row.get("damStorageLvl", ""),
            "naramata_disch": naramata_disch.get(t, ""),
            "naramata_stor_rate": naramata_rate.get(t, ""),
            "yagisawa_disch": yagisawa_disch.get(t, ""),
            "yagisawa_stor_rate": yagisawa_rate.get(t, ""),
            "aimata_disch": aimata_disch.get(t, ""),
            "aimata_stor_rate": aimata_rate.get(t, ""),
            "yubara_rn10m": row.get("rain10m", ""),
            "yubara_rn_inc": row.get("rainInc", "")
        })

    # 月別CSVファイルに書き込み
    for ym, new_rows in month_records.items():
        for target_dir in [HISTORY_DIR, PUBLIC_HISTORY_DIR]:
            csv_path = os.path.join(target_dir, f"{ym}.csv")
            existing_times = set()
            existing_rows = []

            if os.path.exists(csv_path):
                with open(csv_path, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        existing_times.add(r.get("obsTime"))
                        existing_rows.append(r)

            # 新規行のうち未登録のもののみ追加
            added_count = 0
            for nr in new_rows:
                if nr["obsTime"] not in existing_times:
                    existing_rows.append(nr)
                    existing_times.add(nr["obsTime"])
                    added_count += 1

            # 時刻昇順でソート
            existing_rows.sort(key=lambda x: x.get("obsTime", ""))

            with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
                writer.writeheader()
                writer.writerows(existing_rows)


def update_daily_summary(year_str):
    """月別CSVから日別サマリー (最高・最低・平均・ダム貯水率/量) を集計して daily_YYYY.json & .csv に保存"""
    # 該当年の月別CSVをすべて検索
    all_rows = []
    for ym_file in sorted(os.listdir(HISTORY_DIR)):
        if ym_file.startswith(year_str) and ym_file.endswith(".csv") and not ym_file.startswith("daily_"):
            csv_path = os.path.join(HISTORY_DIR, ym_file)
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    all_rows.append(r)

    if not all_rows:
        return

    # 日ごとに集計
    daily_groups = {}
    for r in all_rows:
        t = r.get("obsTime", "")
        if not t or len(t) < 10:
            continue
        date_str = t[:10]  # "2026/08/21"
        if date_str not in daily_groups:
            daily_groups[date_str] = []
        daily_groups[date_str].append(r)

    daily_summary_list = []

    for date_str, rows in sorted(daily_groups.items()):
        # 湯原水位
        yubara_vals = [float(r["yubara_stg"]) for r in rows if r.get("yubara_stg") not in ("", None, "-")]
        yubara_max = max(yubara_vals) if yubara_vals else None
        yubara_min = min(yubara_vals) if yubara_vals else None
        yubara_avg = round(sum(yubara_vals) / len(yubara_vals), 2) if yubara_vals else None

        # 藤原ダム 放流量
        fujiwara_disch_vals = [float(r["fujiwara_disch"]) for r in rows if r.get("fujiwara_disch") not in ("", None, "-")]
        fujiwara_disch_max = max(fujiwara_disch_vals) if fujiwara_disch_vals else None
        fujiwara_disch_avg = round(sum(fujiwara_disch_vals) / len(fujiwara_disch_vals), 2) if fujiwara_disch_vals else None

        # 藤原ダム 流入量
        fujiwara_inflow_vals = [float(r["fujiwara_inflow"]) for r in rows if r.get("fujiwara_inflow") not in ("", None, "-")]
        fujiwara_inflow_avg = round(sum(fujiwara_inflow_vals) / len(fujiwara_inflow_vals), 2) if fujiwara_inflow_vals else None

        # 最新のダム貯水率・貯水量
        last_row = rows[-1]
        fujiwara_rate = float(last_row["fujiwara_stor_rate"]) if last_row.get("fujiwara_stor_rate") not in ("", None, "-") else None
        fujiwara_cap = float(last_row["fujiwara_stor_cap"]) if last_row.get("fujiwara_stor_cap") not in ("", None, "-") else None
        naramata_rate = float(last_row["naramata_stor_rate"]) if last_row.get("naramata_stor_rate") not in ("", None, "-") else None
        yagisawa_rate = float(last_row["yagisawa_stor_rate"]) if last_row.get("yagisawa_stor_rate") not in ("", None, "-") else None
        aimata_rate = float(last_row["aimata_stor_rate"]) if last_row.get("aimata_stor_rate") not in ("", None, "-") else None

        # 日雨量 (最大累計雨量)
        rain_vals = [float(r["yubara_rn10m"]) for r in rows if r.get("yubara_rn10m") not in ("", None, "-")]
        rain_total = round(sum(rain_vals), 1) if rain_vals else 0.0

        daily_summary_list.append({
            "date": date_str,
            "yubara_max": yubara_max,
            "yubara_min": yubara_min,
            "yubara_avg": yubara_avg,
            "fujiwara_disch_max": fujiwara_disch_max,
            "fujiwara_disch_avg": fujiwara_disch_avg,
            "fujiwara_inflow_avg": fujiwara_inflow_avg,
            "fujiwara_stor_rate": fujiwara_rate,
            "fujiwara_stor_cap": fujiwara_cap,
            "naramata_stor_rate": naramata_rate,
            "yagisawa_stor_rate": yagisawa_rate,
            "aimata_stor_rate": aimata_rate,
            "rain_total": rain_total,
            "sample_count": len(rows)
        })

    # JSON & CSV 保存
    daily_summary_data = {
        "year": year_str,
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
        "total_days": len(daily_summary_list),
        "daily_data": daily_summary_list
    }

    for target_dir in [HISTORY_DIR, PUBLIC_HISTORY_DIR]:
        # JSON
        json_path = os.path.join(target_dir, f"daily_{year_str}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(daily_summary_data, f, ensure_ascii=False, indent=2)

        # CSV
        csv_path = os.path.join(target_dir, f"daily_{year_str}.csv")
        if daily_summary_list:
            headers = list(daily_summary_list[0].keys())
            with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=headers)
                writer.writeheader()
                writer.writerows(daily_summary_list)


if __name__ == "__main__":
    jst_now = datetime.now(timezone(timedelta(hours=9)))
    print(f"[{jst_now.strftime('%Y-%m-%d %H:%M:%S')}] Fetching latest river data...")
    data = fetch_all_river_data()

    # 1. latest.json 保存
    update_latest_json(data)
    print("Updated latest.json")

    # 2. 月別10分詳細CSVへの追記
    append_to_monthly_csv(data)
    print("Updated monthly CSV history")

    # 3. 年間日別サマリーの集計と保存
    year_str = str(jst_now.year)
    update_daily_summary(year_str)
    print(f"Updated daily summary for {year_str}")

    print("All tasks completed successfully.")
