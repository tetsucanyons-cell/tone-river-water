"""
GitHub Actions & ローカル定期実行用データ蓄積スクリプト (クリーン・堅牢版)
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
    for out_dir in [DATA_DIR, PUBLIC_DATA_DIR]:
        target_file = os.path.join(out_dir, "latest.json")
        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def append_to_monthly_csv(data):
    timeline = data.get("main_combined_timeline", [])
    if not timeline:
        return

    stg_map = data.get("stations", {}).get("stg", {})
    dam_map = data.get("stations", {}).get("dam", {})

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

    month_records = {}
    for row in timeline:
        t = row.get("obsTime", "")
        if not t or len(t) < 7:
            continue
        ym = t[:7].replace("/", "-")
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

    for ym, new_rows in month_records.items():
        csv_path = os.path.join(HISTORY_DIR, f"{ym}.csv")
        row_dict = {}

        if os.path.exists(csv_path):
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                for r in reader:
                    if r and len(r) >= 1 and not r[0].startswith("<") and not r[0].startswith("="):
                        time_key = r[0]
                        # 正常な行のみ保持
                        clean_row = {CSV_HEADERS[i]: (r[i] if i < len(r) else "") for i in range(len(CSV_HEADERS))}
                        clean_row["obsTime"] = time_key
                        row_dict[time_key] = clean_row

        for nr in new_rows:
            time_key = nr.get("obsTime")
            if time_key:
                row_dict[time_key] = nr

        sorted_rows = sorted(row_dict.values(), key=lambda x: x.get("obsTime", ""))

        for target_dir in [HISTORY_DIR, PUBLIC_HISTORY_DIR]:
            out_path = os.path.join(target_dir, f"{ym}.csv")
            with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(sorted_rows)


def update_daily_summary(year_str):
    all_rows = []
    for ym_file in sorted(os.listdir(HISTORY_DIR)):
        if ym_file.startswith(year_str) and ym_file.endswith(".csv") and not ym_file.startswith("daily_"):
            csv_path = os.path.join(HISTORY_DIR, ym_file)
            with open(csv_path, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    if r.get("obsTime") and not r.get("obsTime", "").startswith("<"):
                        all_rows.append(r)

    if not all_rows:
        return

    daily_groups = {}
    for r in all_rows:
        t = r.get("obsTime", "")
        if not t or len(t) < 10:
            continue
        date_str = t[:10]
        if date_str not in daily_groups:
            daily_groups[date_str] = []
        daily_groups[date_str].append(r)

    daily_summary_list = []

    def safe_float(v):
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    for date_str, rows in sorted(daily_groups.items()):
        yubara_vals = [safe_float(r.get("yubara_stg")) for r in rows if safe_float(r.get("yubara_stg")) is not None]
        yubara_max = max(yubara_vals) if yubara_vals else None
        yubara_min = min(yubara_vals) if yubara_vals else None
        yubara_avg = round(sum(yubara_vals) / len(yubara_vals), 2) if yubara_vals else None

        fujiwara_disch_vals = [safe_float(r.get("fujiwara_disch")) for r in rows if safe_float(r.get("fujiwara_disch")) is not None]
        fujiwara_disch_max = max(fujiwara_disch_vals) if fujiwara_disch_vals else None
        fujiwara_disch_avg = round(sum(fujiwara_disch_vals) / len(fujiwara_disch_vals), 2) if fujiwara_disch_vals else None

        fujiwara_inflow_vals = [safe_float(r.get("fujiwara_inflow")) for r in rows if safe_float(r.get("fujiwara_inflow")) is not None]
        fujiwara_inflow_avg = round(sum(fujiwara_inflow_vals) / len(fujiwara_inflow_vals), 2) if fujiwara_inflow_vals else None

        last_row = rows[-1]
        fujiwara_rate = safe_float(last_row.get("fujiwara_stor_rate"))
        fujiwara_cap = safe_float(last_row.get("fujiwara_stor_cap"))
        naramata_rate = safe_float(last_row.get("naramata_stor_rate"))
        yagisawa_rate = safe_float(last_row.get("yagisawa_stor_rate"))
        aimata_rate = safe_float(last_row.get("aimata_stor_rate"))

        rain_vals = [safe_float(r.get("yubara_rn10m")) for r in rows if safe_float(r.get("yubara_rn10m")) is not None]
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

    daily_summary_data = {
        "year": year_str,
        "updated_at": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S"),
        "total_days": len(daily_summary_list),
        "daily_data": daily_summary_list
    }

    for target_dir in [HISTORY_DIR, PUBLIC_HISTORY_DIR]:
        json_path = os.path.join(target_dir, f"daily_{year_str}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(daily_summary_data, f, ensure_ascii=False, indent=2)

        csv_path = os.path.join(target_dir, f"daily_{year_str}.csv")
        if daily_summary_list:
            headers = list(daily_summary_list[0].keys())
            with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(daily_summary_list)


if __name__ == "__main__":
    jst_now = datetime.now(timezone(timedelta(hours=9)))
    print(f"[{jst_now.strftime('%Y-%m-%d %H:%M:%S')}] Fetching latest river data...")
    data = fetch_all_river_data()

    update_latest_json(data)
    print("Updated latest.json")

    append_to_monthly_csv(data)
    print("Updated monthly CSV history")

    year_str = str(jst_now.year)
    update_daily_summary(year_str)
    print(f"Updated daily summary for {year_str}")

    print("All tasks completed successfully.")
