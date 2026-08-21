/**
 * 利根川 水位・ダム速報 JavaScript (iPhone 17 年間履歴 & CSVエクスポート対応版)
 * リアルタイム10分データ取得、年間/月間履歴集計、Chart.js動的描画、CSV出力
 */

let appData = null;
let historyData = null;
let currentPeriod = "1d"; // "1d" | "1m" | "1y"
let charts = {};
let countdownInterval = null;
let isFetching = false;

// 天気コード (WMO Weather codes)
const WMO_WEATHER_MAP = {
  0: { text: "快晴", icon: "☀️" },
  1: { text: "概ね晴れ", icon: "🌤️" },
  2: { text: "一部曇り", icon: "⛅" },
  3: { text: "曇り", icon: "☁️" },
  45: { text: "霧", icon: "🌫️" },
  48: { text: "霧氷", icon: "🌫️" },
  51: { text: "小雨 (弱)", icon: "🌦️" },
  53: { text: "小雨 (並)", icon: "🌧️" },
  55: { text: "小雨 (強)", icon: "🌧️" },
  61: { text: "雨 (小)", icon: "🌧️" },
  63: { text: "雨 (中)", icon: "🌧️" },
  65: { text: "激しい雨", icon: "⛈️" },
  71: { text: "小雪", icon: "🌨️" },
  73: { text: "雪 (中)", icon: "🌨️" },
  75: { text: "大雪", icon: "❄️" },
  80: { text: "にわか雨 (弱)", icon: "🌦️" },
  81: { text: "にわか雨 (並)", icon: "🌧️" },
  82: { text: "にわか雨 (激)", icon: "⛈️" },
  95: { text: "雷雨", icon: "⚡" },
  96: { text: "雷雨・雹", icon: "⛈️" },
};

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initRefreshButton();
  initPeriodSelector();
  initExportButtons();
  loadData();
  loadHistoryData();
  startCountdownTimer();
});

/* ================= タブ切り替え (iOS ボトムバー対応) ================= */
function initTabs() {
  const tabBtns = document.querySelectorAll(".bottom-tab-btn, .tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      const targetId = btn.getAttribute("data-tab");
      document.querySelectorAll(`[data-tab="${targetId}"]`).forEach(b => b.classList.add("active"));

      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add("active");
        window.scrollTo({ top: 0, behavior: "instant" });
      }

      if (targetId === "tab-chart") {
        setTimeout(() => {
          Object.values(charts).forEach(c => c && c.resize());
        }, 60);
      }
    });
  });
}

/* ================= 期間セレクター (1日 / 1ヶ月 / 1年間) ================= */
function initPeriodSelector() {
  const periodBtns = document.querySelectorAll(".period-btn");
  periodBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      periodBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      currentPeriod = btn.getAttribute("data-period");
      renderCharts();
    });
  });
}

/* ================= 手動更新ボタン ================= */
function initRefreshButton() {
  const btn = document.getElementById("btn-refresh");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (isFetching) return;
    btn.classList.add("rotating");
    
    loadData(() => {
      loadHistoryData(() => {
        setTimeout(() => btn.classList.remove("rotating"), 500);
      });
    });
  });
}

/* ================= CSVエクスポートボタン ================= */
function initExportButtons() {
  const btnDaily = document.getElementById("btn-export-daily");
  const btnMonthly = document.getElementById("btn-export-monthly");

  if (btnDaily) {
    btnDaily.addEventListener("click", () => {
      exportDailyCsv();
    });
  }

  if (btnMonthly) {
    btnMonthly.addEventListener("click", () => {
      exportMonthlyCsv();
    });
  }
}

/* ================= カウントダウンタイマー (10分周期) ================= */
function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);

  function updateTimer() {
    const now = new Date();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();
    
    const next10Min = Math.ceil((currentMin + 0.01) / 10) * 10;
    let diffMinutes = next10Min - currentMin - 1;
    let diffSeconds = 60 - currentSec;
    if (diffSeconds === 60) {
      diffSeconds = 0;
      diffMinutes += 1;
    }
    
    const totalSeconds = diffMinutes * 60 + diffSeconds;
    const mStr = String(diffMinutes).padStart(2, "0");
    const sStr = String(diffSeconds).padStart(2, "0");
    
    const timerElem = document.getElementById("countdown-timer");
    if (timerElem) {
      timerElem.textContent = `${mStr}:${sStr}`;
    }

    if (totalSeconds <= 1) {
      setTimeout(() => {
        loadData();
        loadHistoryData();
      }, 3000);
    }
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

/* ================= 最新データ読み込み ================= */
async function loadData(callback) {
  isFetching = true;
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const timestamp = Date.now();
  
  const apiUrls = isLocal 
    ? [`/api/data?_t=${timestamp}`]
    : [`/api/data?_t=${timestamp}`, `./data/latest.json?_t=${timestamp}`];

  let loaded = false;

  for (const url of apiUrls) {
    try {
      const response = await fetch(url, { 
        cache: "no-store",
        headers: { "Pragma": "no-cache", "Cache-Control": "no-cache" }
      });
      if (response.ok) {
        const json = await response.json();
        if (json && (json.main_combined_timeline || json.stations)) {
          appData = json;
          renderDashboard(appData);
          loaded = true;
          break;
        }
      }
    } catch (err) {
      console.warn(`Fetch failed for ${url}:`, err);
    }
  }

  if (!loaded) {
    try {
      const staticUrl = `./data/latest.json?_t=${timestamp}`;
      const response = await fetch(staticUrl, {
        cache: "no-store",
        headers: { "Pragma": "no-cache", "Cache-Control": "no-cache" }
      });
      if (response.ok) {
        appData = await response.json();
        renderDashboard(appData);
        loaded = true;
      }
    } catch (e) {
      console.error("Static data fetch failed:", e);
    }
  }

  isFetching = false;
  if (callback) callback();
}

/* ================= 年間・日別履歴データ読み込み (daily_YYYY.json) ================= */
async function loadHistoryData(callback) {
  const currentYear = new Date().getFullYear();
  const timestamp = Date.now();
  const url = `./data/history/daily_${currentYear}.json?_t=${timestamp}`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "Pragma": "no-cache", "Cache-Control": "no-cache" }
    });
    if (res.ok) {
      historyData = await res.json();
      if (currentPeriod !== "1d") {
        renderCharts();
      }
    }
  } catch (e) {
    console.warn("Failed to load daily history:", e);
  }

  if (callback) callback();
}

/* ================= 画面全体のレンダリング ================= */
function renderDashboard(data) {
  if (!data) return;

  const obsTimeElem = document.getElementById("latest-obs-time");
  if (obsTimeElem) {
    obsTimeElem.textContent = data.latest_obs_time || "--/-- --:--";
  }

  renderSpotlights(data);
  renderCombinedTimeline(data.main_combined_timeline);
  renderStgCards(data.stations.stg);
  renderDamCards(data.stations.dam);
  renderCharts();
  renderWeather(data.weather, data.stations.rain);
}

/* ================= メインハイライト (湯原 × 藤原) ================= */
function renderSpotlights(data) {
  const yubara = (data.stations.stg && data.stations.stg.yubara) || {};
  const yubaraCur = yubara.current || {};
  const fujiwara = (data.stations.dam && data.stations.dam.fujiwara) || {};
  const fujiwaraCur = fujiwara.current || {};
  const yubaraRn = (data.stations.rain && data.stations.rain.yubara_rn) || {};
  const yubaraRnCur = yubaraRn.current || {};

  // 湯原水位
  const stgVal = yubaraCur.stg !== undefined && yubaraCur.stg !== null ? Number(yubaraCur.stg).toFixed(2) : "--.--";
  document.getElementById("yubara-current-stg").textContent = stgVal;

  const chg10m = yubaraCur.stg10mChg;
  const chg10mElem = document.getElementById("yubara-10m-chg");
  if (chg10m !== undefined && chg10m !== null) {
    const sign = chg10m > 0 ? "+" : "";
    chg10mElem.textContent = `${sign}${Number(chg10m).toFixed(2)} m`;
    chg10mElem.className = "sub-val " + (chg10m > 0 ? "chg-up" : chg10m < 0 ? "chg-down" : "chg-zero");
  } else {
    chg10mElem.textContent = "--";
  }

  const chg1h = yubaraCur.stgHrChg;
  const chg1hElem = document.getElementById("yubara-1h-chg");
  if (chg1h !== undefined && chg1h !== null) {
    const sign = chg1h > 0 ? "+" : "";
    chg1hElem.textContent = `${sign}${Number(chg1h).toFixed(2)} m`;
    chg1hElem.className = "sub-val " + (chg1h > 0 ? "chg-up" : chg1h < 0 ? "chg-down" : "chg-zero");
  } else {
    chg1hElem.textContent = "--";
  }

  const stgHght = yubaraCur.stgHght;
  document.getElementById("yubara-stg-hght").textContent = stgHght ? `${Number(stgHght).toFixed(2)} m` : "-- m";

  // トレンドバッジ
  const trendBadge = document.getElementById("yubara-trend-badge");
  if (chg10m > 0) {
    trendBadge.className = "trend-badge trend-up";
    trendBadge.innerHTML = '<span class="trend-arrow">▲</span><span class="trend-text">増水傾向</span>';
  } else if (chg10m < 0) {
    trendBadge.className = "trend-badge trend-down";
    trendBadge.innerHTML = '<span class="trend-arrow">▼</span><span class="trend-text">減水傾向</span>';
  } else {
    trendBadge.className = "trend-badge trend-flat";
    trendBadge.innerHTML = '<span class="trend-arrow">→</span><span class="trend-text">安定</span>';
  }

  // 藤原ダム
  const dischVal = fujiwaraCur.allDisch !== undefined && fujiwaraCur.allDisch !== null ? Number(fujiwaraCur.allDisch).toFixed(2) : "--.--";
  document.getElementById("fujiwara-current-disch").textContent = dischVal;

  const inflowVal = fujiwaraCur.allSink !== undefined && fujiwaraCur.allSink !== null ? Number(fujiwaraCur.allSink).toFixed(2) : "--.--";
  document.getElementById("fujiwara-current-inflow").textContent = inflowVal;

  const rateVal = fujiwaraCur.storPcntIrr !== undefined && fujiwaraCur.storPcntIrr !== null ? fujiwaraCur.storPcntIrr : "--";
  document.getElementById("fujiwara-storage-rate").textContent = `${rateVal}%`;

  const lvlVal = fujiwaraCur.storLvl !== undefined && fujiwaraCur.storLvl !== null ? Number(fujiwaraCur.storLvl).toFixed(2) : "--";
  document.getElementById("fujiwara-storage-lvl").textContent = `${lvlVal} m`;

  const rnVal = yubaraRnCur.rn10m !== undefined && yubaraRnCur.rn10m !== null ? yubaraRnCur.rn10m : 0;
  document.getElementById("yubara-current-rain").textContent = `${rnVal} mm`;
}

/* ================= 10分刻み実績タイムライン ================= */
function renderCombinedTimeline(timeline) {
  const tbody = document.getElementById("timeline-tbody");
  if (!tbody) return;

  if (!timeline || timeline.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">データが取得できませんでした</td></tr>';
    return;
  }

  let html = "";
  timeline.forEach((row, index) => {
    const isLatest = index === 0;
    const timeStr = row.obsTime ? row.obsTime.substring(11, 16) : "--:--";
    
    const stgText = row.stg !== null && row.stg !== undefined ? Number(row.stg).toFixed(2) : "--";
    
    let chgHtml = '<span class="chg-zero">0.00</span>';
    if (row.stg10mChg !== null && row.stg10mChg !== undefined) {
      const c = Number(row.stg10mChg);
      if (c > 0) {
        chgHtml = `<span class="chg-up">+${c.toFixed(2)}</span>`;
      } else if (c < 0) {
        chgHtml = `<span class="chg-down">${c.toFixed(2)}</span>`;
      }
    }

    const dischText = row.damDischarge !== null && row.damDischarge !== undefined ? Number(row.damDischarge).toFixed(2) : "--";
    const inflowText = row.damInflow !== null && row.damInflow !== undefined ? Number(row.damInflow).toFixed(2) : "--";
    const rainText = row.rain10m !== null && row.rain10m !== undefined ? row.rain10m : "--";
    const storageText = row.damStorageRate !== null && row.damStorageRate !== undefined ? `${row.damStorageRate}%` : "--";

    html += `
      <tr class="${isLatest ? 'latest-row' : ''}">
        <td class="col-time">${timeStr}${isLatest ? ' <span style="color:#06b6d4;font-size:0.7em;">●最新</span>' : ''}</td>
        <td class="col-stg">${stgText}</td>
        <td class="col-chg">${chgHtml}</td>
        <td class="col-disch">${dischText}</td>
        <td class="col-inflow">${inflowText}</td>
        <td class="col-rain">${rainText}</td>
        <td class="col-storage">${storageText}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/* ================= 水位観測所一覧 (4地点) ================= */
function renderStgCards(stgObj) {
  const container = document.getElementById("stg-cards-container");
  if (!container || !stgObj) return;

  let html = "";
  for (const [key, stg] of Object.entries(stgObj)) {
    const cur = stg.current || {};
    const stgVal = cur.stg !== undefined && cur.stg !== null ? Number(cur.stg).toFixed(2) : "--.--";
    
    const chg10m = cur.stg10mChg;
    let chg10mHtml = "--";
    if (chg10m !== undefined && chg10m !== null) {
      const sign = chg10m > 0 ? "+" : "";
      chg10mHtml = `<span class="${chg10m > 0 ? 'chg-up' : chg10m < 0 ? 'chg-down' : 'chg-zero'}">${sign}${Number(chg10m).toFixed(2)} m</span>`;
    }

    const chg1h = cur.stgHrChg;
    let chg1hHtml = "--";
    if (chg1h !== undefined && chg1h !== null) {
      const sign = chg1h > 0 ? "+" : "";
      chg1hHtml = `<span class="${chg1h > 0 ? 'chg-up' : chg1h < 0 ? 'chg-down' : 'chg-zero'}">${sign}${Number(chg1h).toFixed(2)} m</span>`;
    }

    const stgHght = cur.stgHght ? `${Number(cur.stgHght).toFixed(2)} m` : "-- m";
    const obsTime = cur.obsTime ? cur.obsTime.substring(11, 16) : "--:--";

    html += `
      <div class="station-card ${stg.isMain ? 'is-main-card' : ''}">
        <div class="card-top">
          <div>
            ${stg.isMain ? '<div class="card-tag">MAIN STATION</div>' : ''}
            <h4>${stg.name}</h4>
            <span class="river-name">${stg.river}</span>
          </div>
          <span style="font-size:0.75rem;color:var(--text-muted);">${obsTime} 現在</span>
        </div>

        <div class="card-primary-stat">
          <span class="hero-label">現在水位</span>
          <div class="hero-value-wrap" style="margin:0;">
            <span class="hero-num" style="font-size:1.85rem;">${stgVal}</span>
            <span class="hero-unit">m</span>
          </div>
        </div>

        <div class="station-details-list">
          <div class="detail-row">
            <span class="detail-label">10分前比</span>
            <span class="detail-value">${chg10mHtml}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">1時間前比</span>
            <span class="detail-value">${chg1hHtml}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">標高水位</span>
            <span class="detail-value">${stgHght}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">観測所コード</span>
            <span class="detail-value" style="font-size:0.72rem;color:var(--text-muted);">${stg.keyCd}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/* ================= ダム諸量一覧 (4ダム) ================= */
function renderDamCards(damObj) {
  const container = document.getElementById("dam-cards-container");
  if (!container || !damObj) return;

  let html = "";
  for (const [key, dam] of Object.entries(damObj)) {
    const cur = dam.current || {};
    const dischVal = cur.allDisch !== undefined && cur.allDisch !== null ? Number(cur.allDisch).toFixed(2) : "--.--";
    const inflowVal = cur.allSink !== undefined && cur.allSink !== null ? Number(cur.allSink).toFixed(2) : "--.--";
    const storageRate = cur.storPcntIrr !== undefined && cur.storPcntIrr !== null ? `${cur.storPcntIrr}%` : "--%";
    const storageLvl = cur.storLvl !== undefined && cur.storLvl !== null ? `${Number(cur.storLvl).toFixed(2)} m` : "-- m";
    const storageCap = cur.storCap !== undefined && cur.storCap !== null ? `${cur.storCap.toLocaleString()} 千m³` : "--";
    const obsTime = cur.obsTime ? cur.obsTime.substring(11, 16) : "--:--";

    html += `
      <div class="station-card ${dam.isMain ? 'is-main-card' : ''}">
        <div class="card-top">
          <div>
            ${dam.isMain ? '<div class="card-tag">MAIN DAM</div>' : ''}
            <h4>${dam.name}</h4>
            <span class="river-name">${dam.river}</span>
          </div>
          <div class="storage-badge">
            <span>貯水率: <strong>${storageRate}</strong></span>
          </div>
        </div>

        <div class="dam-metrics-row">
          <div class="dam-stat-box discharge-box">
            <span class="stat-label">全放流量 (出水)</span>
            <div class="stat-num-wrap">
              <span class="stat-num highlight-num" style="font-size:1.35rem;">${dischVal}</span>
              <span class="stat-unit">m³/s</span>
            </div>
          </div>
          <div class="dam-stat-box inflow-box">
            <span class="stat-label">全流入量 (入水)</span>
            <div class="stat-num-wrap">
              <span class="stat-num" style="font-size:1.35rem; color:#38bdf8;">${inflowVal}</span>
              <span class="stat-unit">m³/s</span>
            </div>
          </div>
        </div>

        <div class="station-details-list">
          <div class="detail-row">
            <span class="detail-label">貯水位</span>
            <span class="detail-value">${storageLvl}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">貯水量</span>
            <span class="detail-value">${storageCap}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">観測時刻</span>
            <span class="detail-value">${obsTime}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">ダム管理コード</span>
            <span class="detail-value" style="font-size:0.72rem;color:var(--text-muted);">${dam.keyCd}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/* ================= グラフ推移描画 (期間切り替え対応: 1日 / 1ヶ月 / 1年間) ================= */
function renderCharts() {
  if (!appData) return;

  const mainTitleElem = document.getElementById("chart-main-title");
  const mainSubElem = document.getElementById("chart-main-sub");
  const storageTitleElem = document.getElementById("chart-dam-storage-title");

  // A. 1日推移 (10分刻みリアルタイム)
  if (currentPeriod === "1d" || !historyData || !historyData.daily_data || historyData.daily_data.length === 0) {
    if (mainTitleElem) mainTitleElem.textContent = "湯原水位 & 藤原ダム放流量 (1日推移)";
    if (mainSubElem) mainSubElem.textContent = "10分毎";
    if (storageTitleElem) storageTitleElem.textContent = "藤原ダム 貯水率 (%) & 貯水量 (千m³)";

    renderCharts1Day();
    return;
  }

  // B. 1ヶ月 or 1年間推移 (日別集計データ)
  const isMonth = currentPeriod === "1m";
  const allDays = historyData.daily_data || [];
  const days = isMonth ? allDays.slice(-30) : allDays;

  if (mainTitleElem) mainTitleElem.textContent = isMonth ? "湯原水位 & 藤原放流量 (直近1ヶ月・日別)" : "湯原水位 & 藤原放流量 (2026年 年間推移)";
  if (mainSubElem) mainSubElem.textContent = isMonth ? "日別集計" : "年間推移";
  if (storageTitleElem) storageTitleElem.textContent = isMonth ? "藤原ダム 貯水率 ＆ 貯水量 (直近1ヶ月)" : "藤原ダム 貯水率 ＆ 貯水量 (2026年 年間推移)";

  renderChartsHistorical(days);
}

/* 1日推移グラフ描画 (10分データ) */
function renderCharts1Day() {
  const timeline = appData.main_combined_timeline || [];
  if (timeline.length === 0) return;

  const reversed = [...timeline].reverse();
  const labels = reversed.map(r => r.obsTime ? r.obsTime.substring(11, 16) : "");
  
  // 1. メイン二軸グラフ
  const ctxMain = document.getElementById("chart-main-combined");
  if (ctxMain) {
    if (charts.main) charts.main.destroy();

    charts.main = new Chart(ctxMain, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "湯原 水位 (m)",
            data: reversed.map(r => r.stg),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.15)",
            borderWidth: 3,
            fill: true,
            yAxisID: "y-stg",
            tension: 0.25,
            pointRadius: 1
          },
          {
            label: "藤原 放流量 (m³/s)",
            data: reversed.map(r => r.damDischarge),
            borderColor: "#fbbf24",
            borderWidth: 2.5,
            borderDash: [4, 4],
            yAxisID: "y-dam",
            tension: 0.2,
            pointRadius: 1
          },
          {
            label: "藤原 流入量 (m³/s)",
            data: reversed.map(r => r.damInflow),
            borderColor: "#06b6d4",
            borderWidth: 1.5,
            yAxisID: "y-dam",
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: getChartOptions("水位 (m)", "流量 (m³/s)")
    });
  }

  // 2. ダム貯水率 & 貯水量グラフ
  const ctxStorage = document.getElementById("chart-dam-storage");
  if (ctxStorage) {
    if (charts.storage) charts.storage.destroy();

    charts.storage = new Chart(ctxStorage, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "藤原 貯水率 (%)",
            data: reversed.map(r => r.damStorageRate),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.2)",
            borderWidth: 2.5,
            fill: true,
            yAxisID: "y-rate",
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          "y-rate": { min: 0, max: 100, ticks: { color: "#3b82f6" }, title: { display: true, text: "貯水率 (%)", color: "#3b82f6", font: { size: 10 } } }
        }
      }
    });
  }

  // 3. 4大水位計 比較グラフ
  const ctxStgAll = document.getElementById("chart-stg-all");
  if (ctxStgAll && appData.stations.stg) {
    if (charts.stgAll) charts.stgAll.destroy();

    const stgColors = { yubara: "#38bdf8", tsukiyono: "#a78bfa", kosode: "#34d399", yujuku: "#f472b6" };
    const datasets = [];
    for (const [key, stg] of Object.entries(appData.stations.stg)) {
      const revList = [...(stg.min10Values || [])].reverse();
      const listMap = { ...Object.fromEntries(revList.map(r => [r.obsTime, r.stg])) };
      const series = reversed.map(r => listMap[r.obsTime] !== undefined ? listMap[r.obsTime] : null);

      datasets.push({
        label: stg.name,
        data: series,
        borderColor: stgColors[key] || "#ffffff",
        borderWidth: stg.isMain ? 3 : 2,
        tension: 0.25,
        pointRadius: 0
      });
    }

    charts.stgAll = new Chart(ctxStgAll, {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          y: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#94a3b8" } }
        }
      }
    });
  }
}

/* 1ヶ月 / 1年間 履歴グラフ描画 (日別集計データ) */
function renderChartsHistorical(days) {
  if (!days || days.length === 0) return;

  const labels = days.map(d => d.date ? d.date.substring(5) : ""); // "08/21"

  // 1. 水位 (最高・最低・平均) & 放流量
  const ctxMain = document.getElementById("chart-main-combined");
  if (ctxMain) {
    if (charts.main) charts.main.destroy();

    charts.main = new Chart(ctxMain, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "湯原 日最高水位 (m)",
            data: days.map(d => d.yubara_max),
            borderColor: "#f43f5e",
            borderWidth: 2,
            tension: 0.2,
            yAxisID: "y-stg",
            pointRadius: days.length > 60 ? 0 : 2
          },
          {
            label: "湯原 日平均水位 (m)",
            data: days.map(d => d.yubara_avg),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.15)",
            fill: true,
            borderWidth: 2.5,
            tension: 0.2,
            yAxisID: "y-stg",
            pointRadius: days.length > 60 ? 0 : 2
          },
          {
            label: "湯原 日最低水位 (m)",
            data: days.map(d => d.yubara_min),
            borderColor: "#34d399",
            borderWidth: 2,
            tension: 0.2,
            yAxisID: "y-stg",
            pointRadius: days.length > 60 ? 0 : 2
          },
          {
            label: "藤原 日平均放流 (m³/s)",
            data: days.map(d => d.fujiwara_disch_avg),
            borderColor: "#fbbf24",
            borderWidth: 2,
            borderDash: [3, 3],
            yAxisID: "y-dam",
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: getChartOptions("水位 (m)", "放流 (m³/s)")
    });
  }

  // 2. ダム貯水率 (%) & 貯水量 (千m³)
  const ctxStorage = document.getElementById("chart-dam-storage");
  if (ctxStorage) {
    if (charts.storage) charts.storage.destroy();

    charts.storage = new Chart(ctxStorage, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "藤原 貯水率 (%)",
            data: days.map(d => d.fujiwara_stor_rate),
            borderColor: "#3b82f6",
            borderWidth: 2.5,
            yAxisID: "y-rate",
            tension: 0.2,
            pointRadius: days.length > 60 ? 0 : 2
          },
          {
            label: "奈良俣 貯水率 (%)",
            data: days.map(d => d.naramata_stor_rate),
            borderColor: "#60a5fa",
            borderWidth: 1.5,
            yAxisID: "y-rate",
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: "矢木沢 貯水率 (%)",
            data: days.map(d => d.yagisawa_stor_rate),
            borderColor: "#34d399",
            borderWidth: 1.5,
            yAxisID: "y-rate",
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: "相俣 貯水率 (%)",
            data: days.map(d => d.aimata_stor_rate),
            borderColor: "#f87171",
            borderWidth: 1.5,
            yAxisID: "y-rate",
            tension: 0.2,
            pointRadius: 0
          },
          {
            label: "藤原 貯水量 (千m³)",
            data: days.map(d => d.fujiwara_stor_cap),
            borderColor: "#c084fc",
            borderDash: [4, 4],
            borderWidth: 2,
            yAxisID: "y-cap",
            tension: 0.2,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          "y-rate": {
            type: "linear",
            position: "left",
            min: 0,
            max: 100,
            ticks: { color: "#3b82f6", font: { size: 10 } },
            title: { display: true, text: "貯水率 (%)", color: "#3b82f6", font: { size: 10 } }
          },
          "y-cap": {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { color: "#c084fc", font: { size: 10 } },
            title: { display: true, text: "貯水量 (千m³)", color: "#c084fc", font: { size: 10 } }
          }
        }
      }
    });
  }

  // 3. 4ダム貯水率 比較
  const ctxStgAll = document.getElementById("chart-stg-all");
  if (ctxStgAll) {
    if (charts.stgAll) charts.stgAll.destroy();

    charts.stgAll = new Chart(ctxStgAll, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          { label: "藤原 (利根川)", data: days.map(d => d.fujiwara_stor_rate), borderColor: "#fbbf24", borderWidth: 2.5 },
          { label: "奈良俣 (楢俣川)", data: days.map(d => d.naramata_stor_rate), borderColor: "#60a5fa", borderWidth: 2 },
          { label: "矢木沢 (利根川)", data: days.map(d => d.yagisawa_stor_rate), borderColor: "#34d399", borderWidth: 2 },
          { label: "相俣 (赤谷川)", data: days.map(d => d.aimata_stor_rate), borderColor: "#f87171", borderWidth: 2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          y: { min: 0, max: 100, grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#94a3b8" } }
        }
      }
    });
  }
}

function getChartOptions(yLeftTitle, yRightTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: "#94a3b8", font: { size: 10, family: "Inter" } } },
      tooltip: { padding: 8, cornerRadius: 8 }
    },
    scales: {
      x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 8 } },
      "y-stg": {
        type: "linear",
        position: "left",
        grid: { color: "rgba(255, 255, 255, 0.06)" },
        ticks: { color: "#38bdf8", font: { size: 10 } },
        title: { display: true, text: yLeftTitle, color: "#38bdf8", font: { size: 10 } }
      },
      "y-dam": {
        type: "linear",
        position: "right",
        grid: { drawOnChartArea: false },
        ticks: { color: "#fbbf24", font: { size: 10 } },
        title: { display: true, text: yRightTitle, color: "#fbbf24", font: { size: 10 } }
      }
    }
  };
}

/* ================= CSVエクスポート処理 (UTF-8 BOM付き) ================= */
async function exportDailyCsv() {
  const currentYear = new Date().getFullYear();
  const filename = `利根川水位_藤原ダム_日別集計_${currentYear}年.csv`;
  const url = `./data/history/daily_${currentYear}.csv?_t=${Date.now()}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      triggerDownload(blob, filename);
      return;
    }
  } catch (e) {
    console.warn("Direct CSV download failed, generating from memory:", e);
  }

  // メモリからCSV生成
  if (historyData && historyData.daily_data) {
    let csv = "日付,湯原最高水位(m),湯原最低水位(m),湯原平均水位(m),藤原放流最高(m3/s),藤原放流平均(m3/s),藤原流入平均(m3/s),藤原貯水率(%),藤原貯水量(千m3),奈良俣貯水率(%),矢木沢貯水率(%),相俣貯水率(%),日雨量(mm)\n";
    historyData.daily_data.forEach(d => {
      csv += `${d.date},${d.yubara_max||""},${d.yubara_min||""},${d.yubara_avg||""},${d.fujiwara_disch_max||""},${d.fujiwara_disch_avg||""},${d.fujiwara_inflow_avg||""},${d.fujiwara_stor_rate||""},${d.fujiwara_stor_cap||""},${d.naramata_stor_rate||""},${d.yagisawa_stor_rate||""},${d.aimata_stor_rate||""},${d.rain_total||0}\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, filename);
  } else {
    alert("日別集計データがまだありません。");
  }
}

async function exportMonthlyCsv() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filename = `利根川水位_10分詳細_${ym}.csv`;
  const url = `./data/history/${ym}.csv?_t=${Date.now()}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      triggerDownload(blob, filename);
      return;
    }
  } catch (e) {
    console.warn("Direct monthly CSV failed:", e);
  }

  // タイムラインからCSV生成
  if (appData && appData.main_combined_timeline) {
    let csv = "観測時刻,湯原水位(m),湯原10分変化(m),藤原放流(m3/s),藤原流入(m3/s),藤原貯水率(%),藤原貯水位(m),10分雨量(mm),累計雨量(mm)\n";
    appData.main_combined_timeline.forEach(r => {
      csv += `${r.obsTime},${r.stg||""},${r.stg10mChg||""},${r.damDischarge||""},${r.damInflow||""},${r.damStorageRate||""},${r.damStorageLvl||""},${r.rain10m||""},${r.rainInc||""}\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, filename);
  } else {
    alert("10分詳細データがありません。");
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= 気象・雨量タブ ================= */
function renderWeather(weather, rainStations) {
  const weatherCard = document.getElementById("weather-current-card");
  if (weatherCard && weather && weather.current) {
    const cur = weather.current;
    const wCode = cur.weather_code || 0;
    const wInfo = WMO_WEATHER_MAP[wCode] || { text: "晴れ", icon: "☀️" };
    const temp = cur.temperature_2m !== undefined ? Number(cur.temperature_2m).toFixed(1) : "--";
    const appTemp = cur.apparent_temperature !== undefined ? Number(cur.apparent_temperature).toFixed(1) : "--";
    const humidity = cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : "--";
    const wind = cur.wind_speed_10m !== undefined ? Number(cur.wind_speed_10m).toFixed(1) : "--";

    weatherCard.innerHTML = `
      <div class="weather-hero-content">
        <div>
          <span style="font-size:0.72rem;color:#bae6fd;font-weight:700;">みなかみ町（水上・湯原）現在気象</span>
          <div class="weather-temp-wrap">
            <span class="weather-temp-num">${temp}</span>
            <span style="font-size:1.3rem;font-weight:700;color:#e0f2fe;">°C</span>
          </div>
          <div class="weather-desc">${wInfo.text}</div>
        </div>
        <div class="weather-icon-large">${wInfo.icon}</div>
      </div>

      <div class="weather-sub-metrics">
        <div><span style="color:#bae6fd;font-size:0.68rem;">体感:</span> <strong>${appTemp}°C</strong></div>
        <div><span style="color:#bae6fd;font-size:0.68rem;">湿度:</span> <strong>${humidity}%</strong></div>
        <div><span style="color:#bae6fd;font-size:0.68rem;">風速:</span> <strong>${wind}m/s</strong></div>
      </div>
    `;
  }

  const hourlyContainer = document.getElementById("hourly-forecast-container");
  if (hourlyContainer && weather && weather.hourly) {
    const times = weather.hourly.time || [];
    const temps = weather.hourly.temperature_2m || [];
    const pops = weather.hourly.precipitation_probability || [];
    const codes = weather.hourly.weather_code || [];

    const now = new Date();
    let count = 0;
    let html = "";

    for (let i = 0; i < times.length && count < 12; i++) {
      const t = new Date(times[i]);
      if (t >= new Date(now.getTime() - 3600000)) {
        count++;
        const timeStr = `${t.getHours()}:00`;
        const code = codes[i] || 0;
        const info = WMO_WEATHER_MAP[code] || { icon: "🌤️" };
        const temp = temps[i] !== undefined ? `${Math.round(temps[i])}°` : "--";
        const pop = pops[i] !== undefined ? `${pops[i]}%` : "--";

        html += `
          <div class="hourly-item">
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-icon">${info.icon}</div>
            <div class="hourly-temp">${temp}</div>
            <div class="hourly-pop">☂️ ${pop}</div>
          </div>
        `;
      }
    }
    hourlyContainer.innerHTML = html;
  }

  const rainContainer = document.getElementById("rain-stations-container");
  if (rainContainer && rainStations) {
    let html = "";
    for (const [key, st] of Object.entries(rainStations)) {
      const cur = st.current || {};
      const rn10m = cur.rn10m !== undefined ? `${cur.rn10m} mm` : "--";
      const rn60m = cur.rn60m !== undefined ? `${cur.rn60m} mm` : "--";
      const rnInc = cur.rnInc !== undefined ? `${cur.rnInc} mm` : "--";
      const obsTime = cur.obsTime ? cur.obsTime.substring(11, 16) : "--:--";

      html += `
        <div class="rain-card">
          <div class="rain-card-title">${st.name} <span style="font-size:0.7rem;font-weight:normal;color:var(--text-muted);">(${obsTime})</span></div>
          <div class="rain-stat-row">
            <span>10分雨量:</span>
            <span class="rain-val">${rn10m}</span>
          </div>
          <div class="rain-stat-row">
            <span>1時間雨量:</span>
            <span class="rain-val">${rn60m}</span>
          </div>
          <div class="rain-stat-row">
            <span>連続雨量:</span>
            <span class="rain-val">${rnInc}</span>
          </div>
        </div>
      `;
    }
    rainContainer.innerHTML = html;
  }
}
