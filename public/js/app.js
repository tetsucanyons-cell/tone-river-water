/**
 * 利根川 水位・ダム速報 JavaScript (iPhone 17 & GitHub Pages 対応版)
 * リアルタイム10分データ取得、タイムライン描画、Chart.js描画、タブ制御
 */

let appData = null;
let charts = {};
let countdownInterval = null;

// 観測所定義
const STATIONS_DEF = {
  stg: {
    yubara: { name: "湯原（利根川）", keyCd: "2128900400012", isMain: true, river: "利根川" },
    tsukiyono: { name: "月夜野橋（利根川）", keyCd: "0256100400044", isMain: false, river: "利根川" },
    kosode: { name: "小袖橋/小出（赤谷川）", keyCd: "2128900400009", isMain: false, river: "赤谷川" },
    yujuku: { name: "湯宿（赤谷川）", keyCd: "2128900400070", isMain: false, river: "赤谷川" },
  },
  dam: {
    fujiwara: { name: "藤原ダム", keyCd: "2128900700003", isMain: true, river: "利根川" },
    naramata: { name: "奈良俣ダム", keyCd: "2128900700002", isMain: false, river: "楢俣川" },
    yagisawa: { name: "矢木沢ダム", keyCd: "2128900700001", isMain: false, river: "利根川" },
    aimata: { name: "相俣ダム", keyCd: "2128900700004", isMain: false, river: "赤谷川" },
  },
  rain: {
    yubara_rn: { name: "湯原雨量", keyCd: "2128900100036", isMain: true },
    fujiwara_rn: { name: "藤原雨量", keyCd: "2128900100033", isMain: false },
    aimata_rn: { name: "相俣雨量", keyCd: "2128900100014", isMain: false },
  }
};

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
  loadData();
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

/* ================= 手動更新ボタン ================= */
function initRefreshButton() {
  const btn = document.getElementById("btn-refresh");
  if (!btn) return;
  btn.addEventListener("click", () => {
    btn.classList.add("rotating");
    loadData(() => {
      setTimeout(() => btn.classList.remove("rotating"), 600);
    });
  });
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
      }, 2500);
    }
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

/* ================= データ読み込み (API優先 ＆ スタンドアロン・フォールバック) ================= */
async function loadData(callback) {
  try {
    // 1. ローカル / バックエンドAPIを試行
    const response = await fetch("/api/data", { cache: "no-store" });
    if (response.ok) {
      appData = await response.json();
      renderDashboard(appData);
      if (callback) callback();
      return;
    }
  } catch (e) {
    console.log("API not available, running in standalone client-side mode (GitHub Pages / Direct fetch)");
  }

  // 2. GitHub Pages等でサーバーがない場合のクライアント直接取得フォールバック
  try {
    appData = await fetchClientSideData();
    renderDashboard(appData);
  } catch (err) {
    console.error("Client fetch error:", err);
  }

  if (callback) callback();
}

/* ================= クライアントサイド直接フェッチ (GitHub Pages用) ================= */
async function fetchClientSideData() {
  const proxy = "https://api.allorigins.win/raw?url=";
  const kawabouBase = "https://www.river.go.jp/kawabou/file/files";
  const kawabouSystem = "https://www.river.go.jp/kawabou/file/system";

  // 1. 最新時刻取得
  let timePath = "";
  let latestTimeStr = "";
  try {
    const timeRes = await fetch(proxy + encodeURIComponent(`${kawabouSystem}/tmCrntTime.json`));
    const timeData = await timeRes.json();
    const nums = (timeData.crntObsTime || "").match(/\d+/g);
    if (nums && nums.length >= 5) {
      const [y, m, d, h, min] = nums.map(Number);
      const mRound = Math.floor(min / 10) * 10;
      timePath = `${String(y).padStart(4,'0')}${String(m).padStart(2,'0')}${String(d).padStart(2,'0')}/${String(h).padStart(2,'0')}${String(mRound).padStart(2,'0')}/`;
      latestTimeStr = `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mRound).padStart(2,'0')}`;
    }
  } catch (e) {
    const now = new Date();
    const mRound = Math.floor(now.getMinutes() / 10) * 10;
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate(), h = now.getHours();
    timePath = `${y}${String(m).padStart(2,'0')}${String(d).padStart(2,'0')}/${String(h).padStart(2,'0')}${String(mRound).padStart(2,'0')}/`;
    latestTimeStr = `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mRound).padStart(2,'0')}`;
  }

  const result = {
    updated_at: new Date().toLocaleString("ja-JP"),
    latest_obs_time: latestTimeStr,
    stations: { stg: {}, dam: {}, rain: {} },
    main_combined_timeline: [],
    weather: null
  };

  // 2. 水位・ダム・雨量を並列フェッチ
  const fetchTasks = [];

  for (const [k, st] of Object.entries(STATIONS_DEF.stg)) {
    fetchTasks.push(
      fetch(proxy + encodeURIComponent(`${kawabouBase}/tmlist/stg/${timePath}${st.keyCd}.json`))
        .then(r => r.json())
        .then(d => {
          result.stations.stg[k] = {
            name: st.name, river: st.river, keyCd: st.keyCd, isMain: st.isMain,
            current: d.obsValue || {}, min10Values: d.min10Values || []
          };
        })
        .catch(() => {
          result.stations.stg[k] = { name: st.name, river: st.river, keyCd: st.keyCd, isMain: st.isMain, current: {}, min10Values: [] };
        })
    );
  }

  for (const [k, dam] of Object.entries(STATIONS_DEF.dam)) {
    fetchTasks.push(
      fetch(proxy + encodeURIComponent(`${kawabouBase}/tmlist/dam/${timePath}${dam.keyCd}.json`))
        .then(r => r.json())
        .then(d => {
          result.stations.dam[k] = {
            name: dam.name, river: dam.river, keyCd: dam.keyCd, isMain: dam.isMain,
            current: d.obsValue || {}, min10Values: d.min10Values || []
          };
        })
        .catch(() => {
          result.stations.dam[k] = { name: dam.name, river: dam.river, keyCd: dam.keyCd, isMain: dam.isMain, current: {}, min10Values: [] };
        })
    );
  }

  for (const [k, rn] of Object.entries(STATIONS_DEF.rain)) {
    fetchTasks.push(
      fetch(proxy + encodeURIComponent(`${kawabouBase}/tmlist/rn/${timePath}${rn.keyCd}.json`))
        .then(r => r.json())
        .then(d => {
          result.stations.rain[k] = {
            name: rn.name, keyCd: rn.keyCd, isMain: rn.isMain,
            current: d.obsValue || {}, min10Values: d.min10Values || []
          };
        })
        .catch(() => {
          result.stations.rain[k] = { name: rn.name, keyCd: rn.keyCd, isMain: rn.isMain, current: {}, min10Values: [] };
        })
    );
  }

  // 天気
  fetchTasks.push(
    fetch("https://api.open-meteo.com/v1/forecast?latitude=36.768&longitude=138.971&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&timezone=Asia%2FTokyo&forecast_days=2")
      .then(r => r.json())
      .then(w => { result.weather = w; })
      .catch(() => {})
  );

  await Promise.all(fetchTasks);

  // タイムライン結合
  const yubaraList = (result.stations.stg.yubara && result.stations.stg.yubara.min10Values) || [];
  const fujiwaraList = (result.stations.dam.fujiwara && result.stations.dam.fujiwara.min10Values) || [];
  const yubaraRnList = (result.stations.rain.yubara_rn && result.stations.rain.yubara_rn.min10Values) || [];

  const damMap = Object.fromEntries(fujiwaraList.map(item => [item.obsTime, item]));
  const rnMap = Object.fromEntries(yubaraRnList.map(item => [item.obsTime, item]));

  result.main_combined_timeline = yubaraList.map(stgItem => {
    const t = stgItem.obsTime;
    const damItem = damMap[t] || {};
    const rnItem = rnMap[t] || {};
    return {
      obsTime: t,
      stg: stgItem.stg,
      stg10mChg: stgItem.stg10mChg,
      stgHght: stgItem.stgHght,
      damDischarge: damItem.allDisch,
      damInflow: damItem.allSink,
      damStorageRate: damItem.storPcntIrr,
      damStorageLvl: damItem.storLvl,
      rain10m: rnItem.rn10m,
      rainInc: rnItem.rnInc
    };
  });

  return result;
}

/* ================= 画面全体のレンダリング ================= */
function renderDashboard(data) {
  if (!data) return;

  document.getElementById("latest-obs-time").textContent = data.latest_obs_time || "--/-- --:--";
  renderSpotlights(data);
  renderCombinedTimeline(data.main_combined_timeline);
  renderStgCards(data.stations.stg);
  renderDamCards(data.stations.dam);
  renderCharts(data);
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

  // 湯原 トレンドバッジ
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

/* ================= 10分刻み実績タイムライン (湯原水位 × 藤原放流 × 雨量) ================= */
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
            <span class="hero-num" style="font-size:1.8rem;">${stgVal}</span>
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
            <span class="stat-label">全放流量</span>
            <div class="stat-num-wrap">
              <span class="stat-num highlight-num" style="font-size:1.35rem;">${dischVal}</span>
              <span class="stat-unit">m³/s</span>
            </div>
          </div>
          <div class="dam-stat-box inflow-box">
            <span class="stat-label">全流入量</span>
            <div class="stat-num-wrap">
              <span class="stat-num" style="font-size:1.35rem;">${inflowVal}</span>
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
            <span class="detail-label">管理コード</span>
            <span class="detail-value" style="font-size:0.72rem;color:var(--text-muted);">${dam.keyCd}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/* ================= グラフ推移描画 (Chart.js) ================= */
function renderCharts(data) {
  const timeline = data.main_combined_timeline || [];
  if (timeline.length === 0) return;

  const reversed = [...timeline].reverse();
  const labels = reversed.map(r => r.obsTime ? r.obsTime.substring(11, 16) : "");
  
  // 1. メイン二軸グラフ (湯原水位 & 藤原ダム放流量)
  const ctxMain = document.getElementById("chart-main-combined");
  if (ctxMain) {
    if (charts.main) charts.main.destroy();

    const stgData = reversed.map(r => r.stg);
    const dischData = reversed.map(r => r.damDischarge);

    charts.main = new Chart(ctxMain, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "湯原 水位 (m)",
            data: stgData,
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.15)",
            borderWidth: 3,
            fill: true,
            yAxisID: "y-stg",
            tension: 0.25,
            pointRadius: 1,
            pointHoverRadius: 5
          },
          {
            label: "藤原 放流量 (m³/s)",
            data: dischData,
            borderColor: "#fbbf24",
            backgroundColor: "rgba(251, 191, 36, 0.1)",
            borderWidth: 2.5,
            borderDash: [4, 4],
            yAxisID: "y-dam",
            tension: 0.2,
            pointRadius: 1,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 11, family: "Inter" } } },
          tooltip: { padding: 10, cornerRadius: 8 }
        },
        scales: {
          x: {
            grid: { color: "rgba(255, 255, 255, 0.06)" },
            ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 8 }
          },
          "y-stg": {
            type: "linear",
            position: "left",
            grid: { color: "rgba(255, 255, 255, 0.06)" },
            ticks: { color: "#38bdf8", font: { size: 10 } },
            title: { display: true, text: "水位 (m)", color: "#38bdf8", font: { size: 10 } }
          },
          "y-dam": {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { color: "#fbbf24", font: { size: 10 } },
            title: { display: true, text: "放流 (m³/s)", color: "#fbbf24", font: { size: 10 } }
          }
        }
      }
    });
  }

  // 2. 4大水位計 比較グラフ
  const ctxStgAll = document.getElementById("chart-stg-all");
  if (ctxStgAll && data.stations.stg) {
    if (charts.stgAll) charts.stgAll.destroy();

    const stgColors = { yubara: "#38bdf8", tsukiyono: "#a78bfa", kosode: "#34d399", yujuku: "#f472b6" };
    const datasets = [];
    for (const [key, stg] of Object.entries(data.stations.stg)) {
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
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          y: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#94a3b8" } }
        }
      }
    });
  }

  // 3. 4ダム 放流量比較グラフ
  const ctxDamDisch = document.getElementById("chart-dam-disch");
  if (ctxDamDisch && data.stations.dam) {
    if (charts.damDisch) charts.damDisch.destroy();

    const damColors = { fujiwara: "#fbbf24", naramata: "#60a5fa", yagisawa: "#34d399", aimata: "#f87171" };
    const datasets = [];
    for (const [key, dam] of Object.entries(data.stations.dam)) {
      const revList = [...(dam.min10Values || [])].reverse();
      const listMap = { ...Object.fromEntries(revList.map(r => [r.obsTime, r.allDisch])) };
      const series = reversed.map(r => listMap[r.obsTime] !== undefined ? listMap[r.obsTime] : null);

      datasets.push({
        label: dam.name,
        data: series,
        borderColor: damColors[key] || "#ffffff",
        borderWidth: dam.isMain ? 3 : 2,
        tension: 0.2,
        pointRadius: 0
      });
    }

    charts.damDisch = new Chart(ctxDamDisch, {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#94a3b8", font: { size: 10 } } } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#64748b", maxTicksLimit: 8 } },
          y: { grid: { color: "rgba(255, 255, 255, 0.06)" }, ticks: { color: "#94a3b8" } }
        }
      }
    });
  }
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
