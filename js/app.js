/* ============================================================
   캠핑캐치 — app.js
   상태 · 렌더링 · 이벤트 (실데이터 sites.js + logic.js 사용)

   실데이터(고캠핑): 이름·지역·거리·계절/시설 태그·예약처 링크·사진
   미제공(예약처 확인): 가격 · 실시간 자리 · 후기(→네이버 링크)
   ============================================================ */
window.CC = window.CC || {};

(function (CC) {
  "use strict";

  var FAV_KEY = "cc_favorites";
  var CHK_KEY = "cc_checks";
  var WX_BASE = "https://api.open-meteo.com/v1/forecast";
  // 자리 확인 상태 (tier: 정렬 계층 — 낮을수록 위)
  var CHK = { open: { t: "자리있음", s: "있음", tier: 0 }, booked: { t: "예약함", s: "예약", tier: 1 }, none: { t: "자리없음", s: "없음", tier: 5 } };

  var state = {
    start: "",            // init에서 '이번 주말'로 설정 (예보 범위 안)
    end: "",
    sort: "reco",
    regions: { "파주": false, "연천": false, "포천": false, "강원": false },  // 기본: 미선택 = 전체
    favorites: {},
    checks: {},           // { id: {s:"open"|"none"|"booked", d:"YYYY-MM-DD"} }
    weather: {},          // { id: agg }  (현재 기간 기준)
    weatherKey: "",       // 날씨를 받아둔 "start|end"
    weatherMode: "",      // "loading" | "forecast" | "far" | "fail"
    ctrlOpen: true        // 조건 패널 펼침 여부 (모바일은 기본 접힘)
  };

  var $ = function (id) { return document.getElementById(id); };
  var isFav = function (s) { return !!state.favorites[s.id]; };
  var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };

  /* ---------- 캠핑 기간 헬퍼 ---------- */
  function ymdToDate(s) { return new Date(s + "T00:00:00"); }
  function fmtYmd(d) { var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(); return y + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd; }
  function addDays(ymd, n) { var d = ymdToDate(ymd); d.setDate(d.getDate() + n); return fmtYmd(d); }
  function nightsCount() { return Math.max(1, Math.round((ymdToDate(state.end) - ymdToDate(state.start)) / 86400000)); }
  function periodTxt() {
    var a = ymdToDate(state.start), b = ymdToDate(state.end), n = nightsCount();
    var f = function (d) { return (d.getMonth() + 1) + "/" + d.getDate(); };
    return f(a) + " → " + f(b) + " · " + n + "박 " + (n + 1) + "일";
  }
  function todayYmd() { return fmtYmd(new Date()); }
  function daysFromToday(ymd) { return Math.round((ymdToDate(ymd) - ymdToDate(todayYmd())) / 86400000); }
  function relDay(ymd) { var d = -daysFromToday(ymd); if (d <= 0) return "오늘"; if (d === 1) return "어제"; return d + "일 전"; }

  /* ---------- 빠른 날짜 프리셋 (오늘 기준, 예보 범위 안) ---------- */
  function upcomingSat() { var d = new Date(); var add = (6 - d.getDay() + 7) % 7; return addDays(todayYmd(), add); }
  var PRESETS = {
    tmr:  function () { var s = addDays(todayYmd(), 1); return { start: s, end: addDays(s, 1) }; },
    week: function () { var s = upcomingSat(); return { start: s, end: addDays(s, 1) }; },
    next: function () { var s = addDays(upcomingSat(), 7); return { start: s, end: addDays(s, 1) }; }
  };
  function activePreset() {
    for (var k in PRESETS) { var p = PRESETS[k](); if (p.start === state.start && p.end === state.end) return k; }
    return "";
  }

  /* ---------- 선호(localStorage) ---------- */
  function loadFav() {
    try { JSON.parse(localStorage.getItem(FAV_KEY) || "[]").forEach(function (id) { state.favorites[id] = true; }); }
    catch (e) { /* 무시 */ }
  }
  function saveFav() {
    try {
      var ids = Object.keys(state.favorites).filter(function (k) { return state.favorites[k]; });
      localStorage.setItem(FAV_KEY, JSON.stringify(ids));
    } catch (e) { /* 무시 */ }
  }
  function toggleFav(id) {
    state.favorites[id] = !state.favorites[id];
    saveFav();
    toast(state.favorites[id] ? "선호 캠핑장으로 지정했어요 · 맨 위로 제안합니다" : "선호를 해제했어요");
    renderList();
  }

  /* ---------- 자리 확인 추적 (localStorage) ---------- */
  function loadChecks() { try { state.checks = JSON.parse(localStorage.getItem(CHK_KEY) || "{}") || {}; } catch (e) { state.checks = {}; } }
  function saveChecks() { try { localStorage.setItem(CHK_KEY, JSON.stringify(state.checks)); } catch (e) { /* 무시 */ } }
  function toggleCheck(id, st) {
    var cur = state.checks[id];
    if (cur && cur.s === st) { delete state.checks[id]; toast("확인 표시를 지웠어요"); }
    else { state.checks[id] = { s: st, d: todayYmd() }; toast(CHK[st].t + "(으)로 표시 · 다음에 열어도 기억해요"); }
    saveChecks();
    renderList();
  }

  /* ---------- 날씨 조회 (Open-Meteo, 143곳 한 번에) ---------- */
  function weatherKeyFor() { return state.start + "|" + state.end; }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function fetchWeather() {
    var key = weatherKeyFor();
    // 예보 범위(약 16일) 밖이면 요청하지 않음 — 없는 정밀도를 만들지 않는다
    if (daysFromToday(state.start) > 15) {
      state.weather = {}; state.weatherKey = key; state.weatherMode = "far";
      renderWeatherNote(); renderList(); renderCuration();
      return;
    }
    if (state.weatherKey === key && state.weatherMode === "forecast") { renderWeatherNote(); return; }
    state.weatherMode = "loading"; renderWeatherNote();
    var sites = CC.SITES;
    var lat = sites.map(function (s) { return r3(s.lat); }).join(",");
    var lng = sites.map(function (s) { return r3(s.lng); }).join(",");
    var url = WX_BASE + "?latitude=" + lat + "&longitude=" + lng +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max" +
      "&wind_speed_unit=ms&timezone=Asia%2FSeoul&start_date=" + state.start + "&end_date=" + state.end;
    fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.error) throw new Error(data.reason || "error");
      var arr = Array.isArray(data) ? data : [data];
      var w = {};
      for (var i = 0; i < sites.length && i < arr.length; i++) {
        var agg = CC.wxAggregate(arr[i] && arr[i].daily);
        if (agg) w[sites[i].id] = agg;
      }
      state.weather = w; state.weatherKey = key; state.weatherMode = "forecast";
      renderWeatherNote(); renderList(); renderCuration();
    }).catch(function () {
      state.weather = {}; state.weatherKey = key; state.weatherMode = "fail";
      renderWeatherNote(); renderList();
    });
  }

  /* ---------- 필터 & 정렬 ---------- */
  function anyRegion() {
    return CC.REGION_META.some(function (r) { return state.regions[r.key]; });
  }
  // 지역 미선택 = 전체 표시
  function visibleSites() {
    if (!anyRegion()) return CC.SITES.slice();
    return CC.SITES.filter(function (s) { return state.regions[s.group]; });
  }
  // 날씨 점수는 예보를 신뢰할 수 있는 기간(forecast)에만 반영
  function wxAdj(s) { return state.weatherMode === "forecast" ? CC.wxScore(state.weather[s.id]) : 0; }
  function recoScore(s) { return CC.score(s, state.start) + wxAdj(s); }
  // 정렬 계층: 자리있음 → 예약함 → 선호 → 온라인예약 → 나머지 → 자리없음(맨 아래)
  function tierOf(s) {
    var c = state.checks[s.id];
    if (c && c.s === "open")   return 0;
    if (c && c.s === "booked") return 1;
    if (c && c.s === "none")   return 5;
    if (isFav(s))              return 2;
    if (CC.hasRealtime(s))     return 3;
    return 4;
  }
  function sortedSites() {
    var arr = visibleSites().slice();
    var d = state.start, season = CC.seasonOf(d);
    if (state.sort === "reco")        arr.sort(function (a, b) { return recoScore(b) - recoScore(a); });
    else if (state.sort === "near")   arr.sort(function (a, b) { return a.drive - b.drive; });
    else if (state.sort === "auto")   arr.sort(function (a, b) { return b.autoSite - a.autoSite; });
    else if (state.sort === "season") arr.sort(function (a, b) { return CC.seasonFit(b, season) - CC.seasonFit(a, season) || recoScore(b) - recoScore(a); });
    // 확인상태·선호 계층으로 재배치 (같은 계층 내 위 정렬 유지 = 안정)
    var tiers = [[], [], [], [], [], []];
    arr.forEach(function (s) { tiers[tierOf(s)].push(s); });
    return tiers[0].concat(tiers[1], tiers[2], tiers[3], tiers[4], tiers[5]);
  }

  function pill(text, cls) { return '<span class="pill ' + cls + '"><span class="dot"></span>' + text + '</span>'; }

  /* ---------- 지역 필터 ---------- */
  function renderRegions() {
    var row = $("regionRow"); row.innerHTML = "";
    var noneSel = !anyRegion();

    // '전체' 칩 — 아무 지역도 선택 안 하면 활성(=전체 보기)
    var all = document.createElement("button");
    all.className = "rchip all" + (noneSel ? " on" : "");
    all.setAttribute("aria-pressed", noneSel ? "true" : "false");
    all.innerHTML = (noneSel ? '<span class="rck">✓</span>' : '') + '전체';
    all.onclick = function () {
      CC.REGION_META.forEach(function (r) { state.regions[r.key] = false; });
      render();
    };
    row.appendChild(all);

    CC.REGION_META.forEach(function (r) {
      var on = !!state.regions[r.key];
      var b = document.createElement("button");
      b.className = "rchip" + (on ? " on" : "");
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.innerHTML = (on ? '<span class="rck">✓</span>' : '') + r.key + '<span class="rd">' + r.d + '</span>';
      b.onclick = function () { state.regions[r.key] = !state.regions[r.key]; render(); };
      row.appendChild(b);
    });
  }

  /* ---------- 조건 패널 접기/펼치기 (모바일 답답함 완화) ---------- */
  var SORT_LABEL = { reco: "추천순", near: "가까운순", auto: "오토 규모순", season: "계절 적합순" };
  function shortPeriod() {
    var a = ymdToDate(state.start), b = ymdToDate(state.end);
    var f = function (d) { return (d.getMonth() + 1) + "/" + d.getDate(); };
    return f(a) + "→" + f(b);
  }
  function regionSummary() {
    if (!anyRegion()) return "전체";
    return CC.REGION_META.filter(function (r) { return state.regions[r.key]; }).map(function (r) { return r.key; }).join("·");
  }
  function applyCtrlState() {
    var c = $("controls"); if (!c) return;
    c.classList.toggle("collapsed", !state.ctrlOpen);
    var t = $("ctrlToggle"); if (t) t.setAttribute("aria-expanded", state.ctrlOpen ? "true" : "false");
    var cr = $("ctrlCaret"); if (cr) cr.textContent = state.ctrlOpen ? "접기 ▴" : "조건 변경 ▾";
    var s = $("ctrlSummaryText");
    if (s) s.innerHTML = '📅 ' + shortPeriod() + ' · ' + esc(regionSummary()) + ' · ' + SORT_LABEL[state.sort];
  }
  function isNarrow() { return window.innerWidth <= 640; }

  /* ---------- 빠른 날짜 프리셋 하이라이트 ---------- */
  function renderPresets() {
    var cur = activePreset();
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
      var on = b.getAttribute("data-preset") === cur;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------- 날씨 안내 (예보 신뢰도 정직 표시) ---------- */
  function renderWeatherNote() {
    var el = $("wxNote"); if (!el) return;
    var m = state.weatherMode, html = "", cls = "";
    if (m === "loading")       { html = '⛅ 이 기간 날씨를 불러오는 중…'; cls = "load"; }
    else if (m === "forecast") { html = '🌤️ <b>' + periodTxt() + '</b> 날씨 기준으로 <b>비·바람 좋은 곳을 위로</b> 정렬했어요.'; cls = "ok"; }
    else if (m === "far")      { html = '📅 출발이 아직 멀어 <b>날씨 예보가 나오기 전</b>이에요. 지금은 <b>계절에 맞는 곳</b> 위주로 보여드려요.'; cls = "far"; }
    else if (m === "fail")     { html = '⚠️ 날씨를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'; cls = "fail"; }
    el.className = "wx-note " + cls;
    el.innerHTML = html;
  }

  /* ---------- 계절 배너 ---------- */
  function renderBanner() {
    var s = CC.SEASON[CC.seasonOf(state.start)];
    $("seasonBanner").innerHTML =
      '<span class="se">' + s.emoji + '</span>' +
      '<div><div class="sb-t">' + s.label + ' 시즌 · ' + periodTxt() + '</div>' +
      '<div class="sb-d"><b>' + s.desc + '</b>을(를) 우선 추천합니다.</div></div>';
    $("curTitle").textContent = s.emoji + " 이 계절(" + s.label + ") 추천";
  }

  /* ---------- 계절 큐레이션 ---------- */
  function renderCuration() {
    var season = CC.seasonOf(state.start);
    var picks = visibleSites().slice().sort(function (a, b) {
      return (CC.seasonFit(b, season) - CC.seasonFit(a, season)) || (CC.score(b, state.start) - CC.score(a, state.start));
    }).filter(function (s) { return CC.seasonFit(s, season) > 0; }).slice(0, 6);

    var row = $("curRow"); row.innerHTML = "";
    if (!picks.length) {
      row.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:8px 2px;">이 지역·계절 조합에 딱 맞는 추천이 아직 없어요.</div>';
      return;
    }
    picks.forEach(function (s) {
      var w = (state.weatherMode === "forecast") ? state.weather[s.id] : null;
      var c = document.createElement("button");
      c.className = "cur-card";
      c.innerHTML =
        '<div class="cur-thumb" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + (isFav(s) ? '<span class="cur-fav">⭐</span>' : '') + '</div>' +
        '<div class="cur-b"><div class="ct">' + esc(s.name) + '</div>' +
        '<div class="cr">' + CC.SEASON[season].emoji + ' ' + esc(CC.fitReason(s, season)) + '</div>' +
        '<div class="cm">' + esc(s.region) + ' · 🚗 ' + CC.driveTxt(s.drive) + (w ? ' · ' + CC.wxText(w) : '') + '</div></div>';
      c.onclick = function () { openDetail(s.id); };
      row.appendChild(c);
    });
  }

  /* ---------- 랭킹 목록 ---------- */
  function renderList() {
    var arr = sortedSites();
    var season = CC.seasonOf(state.start);
    var list = $("list"); list.innerHTML = "";
    var liveN = arr.filter(function (s) { return CC.hasRealtime(s); }).length;
    $("resultCount").textContent = arr.length + "곳 · 온라인예약 " + liveN + " · " + CC.SEASON[season].label + " 추천순";

    if (!arr.length) {
      list.innerHTML = '<div class="empty"><div class="ee">🏕️</div><p>선택한 지역에 표시할 오토캠핑장이 없어요.<br>지역을 더 선택해 보세요.</p></div>';
      return;
    }

    arr.forEach(function (s, i) {
      var fav = isFav(s);
      var chk = state.checks[s.id];
      var reason = CC.fitReason(s, season);
      var fit = CC.seasonFit(s, season) >= 1;
      var kid = CC.kidPoints(s).length > 0;
      var w = (state.weatherMode === "forecast") ? state.weather[s.id] : null;
      var rl = CC.reserveLink(s);

      var badges = "";
      if (w) {
        badges += '<span class="pill wx ' + CC.wxClass(w) + '">' + CC.wxText(w) + '</span>';
        badges += '<span class="pill wind ' + CC.windClass(w) + '">' + CC.windText(w) + (w.windSev >= 3 ? ' ⚠' : '') + '</span>';
      }
      if (fav) badges += '<span class="pill fav">⭐ 선호</span>';
      if (fit && reason) badges += '<span class="pill acc">' + CC.SEASON[season].emoji + ' ' + esc(reason) + '</span>';
      if (kid) badges += pill("👨‍👩‍👧 아이 좋아요", "kid");
      if (s.drive <= 40) badges += pill("가까움", "brand");
      if (CC.hasRealtime(s)) badges += pill("🟢 온라인예약", "rt");

      var autoTxt = s.autoSite > 0 ? ("오토 " + s.autoSite + "면") : "오토캠핑";
      var openLabel = rl.calendar ? "🗓️ 예약 열기" : (rl.direct ? "🔗 예약처" : "🔍 예약 검색");
      var trayChk = ["open", "none", "booked"].map(function (st) {
        var on = chk && chk.s === st;
        return '<button class="chk chk-' + st + (on ? ' on' : '') + '" data-chk="' + s.id + '" data-st="' + st + '" title="' + CHK[st].t + '">' + CHK[st].s + '</button>';
      }).join("");
      var tray =
        '<div class="sc-tray">' +
          '<a class="tray-open" href="' + esc(rl.url) + '" target="_blank" rel="noopener">' + openLabel + ' ↗</a>' +
          '<span class="tray-chk">' + trayChk + '</span>' +
          (chk ? '<span class="tray-when">' + relDay(chk.d) + '</span>' : '') +
        '</div>';

      var cState = chk ? (chk.s === "none" ? " checkno" : (chk.s === "booked" ? " checkbk" : " checkon")) : "";
      var card = document.createElement("div");
      card.className = "site-card" + (fav ? " fav" : "") + cState;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", s.name + " 상세 보기");
      card.innerHTML =
        '<div class="sc-rank">' + (fav ? '⭐' : (i + 1)) + '</div>' +
        '<div class="sc-thumb" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + '</div>' +
        '<div class="sc-body">' +
          '<div class="sc-top">' +
            '<div class="sc-title-wrap">' +
              '<button class="fav-btn' + (fav ? ' on' : '') + '" data-fav="' + s.id + '" aria-pressed="' + (fav ? 'true' : 'false') + '" aria-label="선호 지정/해제" title="선호로 지정하면 맨 위로 제안돼요">' + (fav ? '★' : '☆') + '</button>' +
              '<span class="sc-name">' + esc(s.name) + '</span>' +
            '</div>' +
            '<span class="sc-dist">🚗 ' + CC.driveTxt(s.drive) + '</span>' +
          '</div>' +
          '<div class="sc-meta"><span>' + esc(s.region) + '</span><span class="sep">·</span><span>' + autoTxt + '</span></div>' +
          '<div class="sc-badges">' + badges + '</div>' +
          tray +
        '</div>';

      card.onclick = function () { openDetail(s.id); };
      card.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(s.id); } };
      var fb = card.querySelector(".fav-btn");
      fb.onclick = function (e) { e.stopPropagation(); toggleFav(s.id); };
      fb.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); } };
      // 예약 열기: 카드 상세가 열리지 않도록
      var to = card.querySelector(".tray-open");
      if (to) to.addEventListener("click", function (e) { e.stopPropagation(); });
      // 자리 확인 버튼 (있음/없음/예약)
      Array.prototype.forEach.call(card.querySelectorAll(".chk"), function (b) {
        b.addEventListener("click", function (e) { e.stopPropagation(); toggleCheck(b.getAttribute("data-chk"), b.getAttribute("data-st")); });
      });
      list.appendChild(card);
    });
  }

  function render() { applyCtrlState(); renderPresets(); renderRegions(); renderBanner(); renderWeatherNote(); renderCuration(); renderList(); }

  /* ---------- 상세 시트 ---------- */
  var sheetOpen = false;
  function openDetail(id) {
    var s = CC.SITES.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var season = CC.seasonOf(state.start);
    var reason = CC.fitReason(s, season);
    var fit = CC.seasonFit(s, season) >= 1;
    var fav = isFav(s);
    var kp = CC.kidPoints(s);
    var rl = CC.reserveLink(s);
    var w = (state.weatherMode === "forecast") ? state.weather[s.id] : null;
    var chk = state.checks[s.id];

    var heroImg = s.img
      ? '<img class="hero-img" src="' + esc(s.img) + '" alt="" onerror="this.remove()">'
      : '';

    var hint = CC.reserveHint(s);
    var home = CC.homeLink(s);
    var actions =
      '<a class="cta pri" href="' + esc(rl.url) + '" target="_blank" rel="noopener">' + rl.label + ' ↗</a>' +
      '<a class="cta sec" href="' + esc(CC.reviewLink(s)) + '" target="_blank" rel="noopener">네이버 후기</a>';
    var contact = [];
    if (hint) contact.push('예약처: <b>' + esc(hint) + '</b>');
    if (s.tel) contact.push('📞 <a href="tel:' + esc(s.tel) + '">' + esc(s.tel) + '</a>');
    if (home) contact.push('<a href="' + esc(home) + '" target="_blank" rel="noopener">홈페이지 ↗</a>');
    var contactHtml = contact.length ? '<div class="contact-line">' + contact.join(' · ') + '</div>' : '';

    // 날씨·바람 상세 (예보 신뢰구간에서만) / 예보 밖이면 정직하게 안내
    var wxBlock = "";
    if (w) {
      var tip = w.windSev >= 2 ? '<b>바람이 강해요</b> — 타프·텐트 설영에 주의하세요'
              : (w.pop >= 60 ? '<b>비 올 확률이 높아요</b> — 우천 대비 필요'
              : '캠핑하기 무난한 날씨예요');
      wxBlock =
        '<div class="wx-detail ' + CC.wxClass(w) + '">' +
          '<div class="wxd-main">' + w.emoji + ' <b>' + w.tmax + '°</b><span class="wxd-min"> / ' + w.tmin + '°</span> · ' + esc(w.label) + '</div>' +
          '<div class="wxd-sub">' +
            '<span class="chip ' + CC.wxClass(w) + '">☔ 비 ' + w.pop + '%</span>' +
            '<span class="chip ' + CC.windClass(w) + '">💨 바람 ' + w.wind + 'm/s' + (w.gust >= w.wind + 3 ? ' · 돌풍 ' + w.gust : '') + ' · ' + CC.WIND_LABEL[w.windSev] + '</span>' +
          '</div>' +
          '<div class="wxd-note">' + periodTxt() + ' · ' + tip + '</div>' +
        '</div>';
    } else if (state.weatherMode === "far") {
      wxBlock = '<div class="wx-detail far">📅 출발이 아직 멀어 날씨 예보가 나오기 전이에요. 출발이 가까워지면 이 기간 날씨·바람을 보여드려요.</div>';
    }

    // 자리 확인 추적 (있음/없음/예약)
    var chkRow =
      '<div class="chk-detail"><span class="cd-label">여기 자리 확인했나요?</span><div class="cd-btns">' +
      ["open", "none", "booked"].map(function (st) {
        var on = chk && chk.s === st;
        return '<button class="chk chk-' + st + (on ? ' on' : '') + '" data-st="' + st + '">' + CHK[st].t + '</button>';
      }).join("") +
      '</div>' + (chk ? '<span class="cd-when">' + relDay(chk.d) + ' 표시함</span>' : '') + '</div>';

    var srcNote;
    if (rl.calendar) {
      srcNote = '🗓️ <b>' + periodTxt() + '</b> · 아래 <b>예약 캘린더 열기</b>를 누르면 예약 사이트에서 이 기간 <b>실시간 빈자리</b>를 바로 확인·예약할 수 있어요.';
    } else if (rl.direct) {
      srcNote = '🗓️ <b>' + periodTxt() + '</b> · 아래 <b>예약처로 이동</b> 후 <b>' + esc(s.name) + '</b>을(를) 찾아 이 기간 자리를 확인하세요.';
    } else {
      srcNote = '🗓️ <b>' + periodTxt() + '</b> · 온라인 예약 링크가 없어요. <b>전화</b>나 <b>예약 검색(네이버)</b>로 자리·요금을 확인하세요.';
    }

    $("sheet").innerHTML =
      '<div class="sheet-grab"></div>' +
      '<div class="sheet-hero" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + heroImg +
        '<button class="sheet-fav' + (fav ? ' on' : '') + '" id="sheetFav" aria-pressed="' + (fav ? 'true' : 'false') + '" aria-label="선호 지정/해제" title="선호로 지정">' + (fav ? '★' : '☆') + '</button>' +
        '<button class="sheet-close" id="sheetClose" aria-label="닫기">✕</button></div>' +
      '<div class="sheet-b">' +
        '<h2>' + (fav ? '⭐ ' : '') + esc(s.name) + '</h2>' +
        '<div class="sheet-meta"><span>' + esc(s.region) + '</span><span>·</span><span>🚗 김포에서 ' + CC.driveTxt(s.drive) + '</span>' +
          (s.autoSite > 0 ? '<span>·</span><span>오토 ' + s.autoSite + '면</span>' : '') + '</div>' +
        (s.intro ? '<p class="intro">' + esc(s.intro) + '</p>' : '') +
        (fit && reason
          ? '<div class="season-note fit">' + CC.SEASON[season].emoji + ' ' + CC.SEASON[season].label + ' 추천 — ' + esc(reason) + '</div>'
          : '<div class="season-note">이 계절(' + CC.SEASON[season].label + ')엔 우선 추천 대상은 아니에요.</div>') +
        (kp.length ? '<div class="kid-note">👨‍👩‍👧 아이 좋은 곳 — ' + esc(kp.join(" · ")) + '</div>' : '') +
        wxBlock +
        '<div class="blk-h">시설 · 환경</div>' +
        '<div class="tagrow">' + (s.tags.length ? s.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("") : '<span class="tag">정보 준비중</span>') + '</div>' +
        '<div class="src-note">' + srcNote + '</div>' +
        chkRow +
        contactHtml +
        '<div class="cta-row">' + actions + '</div>' +
        '<div class="cta-row second"><a class="cta ghost" href="' + esc(CC.mapLink(s)) + '" target="_blank" rel="noopener">🧭 김포에서 길찾기</a></div>' +
      '</div>';

    $("sheetClose").onclick = closeSheet;
    $("sheetFav").onclick = function () { toggleFav(s.id); openDetail(s.id); };
    Array.prototype.forEach.call($("sheet").querySelectorAll(".chk-detail .chk"), function (b) {
      b.onclick = function () { toggleCheck(s.id, b.getAttribute("data-st")); openDetail(s.id); };
    });

    $("backdrop").classList.add("show");
    var sh = $("sheet"); sh.classList.add("show"); sh.scrollTop = 0;
    document.body.style.overflow = "hidden";
    // 뒤로가기(또는 가장자리 스와이프)로 닫히도록 히스토리 한 칸 추가
    if (!sheetOpen) { sheetOpen = true; history.pushState({ cc: "sheet" }, ""); }
  }

  function closeSheet(fromPop) {
    if (!sheetOpen) return;
    sheetOpen = false;
    $("sheet").classList.remove("show");
    $("backdrop").classList.remove("show");
    document.body.style.overflow = "";
    if (fromPop !== true) history.back();   // ✕·백드롭으로 닫으면 우리가 넣은 히스토리 제거
  }

  /* ---------- 토스트 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------- 초기화 ---------- */
  function syncDateInputs() {
    $("startInp").value = state.start;
    $("startInp").min = todayYmd();              // 지난 날짜만 막고, 미래는 자유롭게
    $("endInp").value = state.end;
    $("endInp").min = addDays(state.start, 1);   // 종료일은 시작일 다음날부터
  }
  function onStartChange(e) {
    if (!e.target.value) { e.target.value = state.start; return; }
    state.start = e.target.value;
    if (ymdToDate(state.end) <= ymdToDate(state.start)) state.end = addDays(state.start, 1);  // 최소 1박 보장
    if (isNarrow()) state.ctrlOpen = false;   // 설정했으면 접어서 결과에 집중
    syncDateInputs(); render(); fetchWeather();
  }
  function onEndChange(e) {
    if (!e.target.value) { e.target.value = state.end; return; }
    state.end = e.target.value;
    if (ymdToDate(state.end) <= ymdToDate(state.start)) state.start = addDays(state.end, -1);
    if (isNarrow()) state.ctrlOpen = false;
    syncDateInputs(); render(); fetchWeather();
  }
  function applyPreset(k) {
    var p = PRESETS[k] && PRESETS[k](); if (!p) return;
    state.start = p.start; state.end = p.end;
    if (isNarrow()) state.ctrlOpen = false;   // 프리셋 선택 = '언제' 정해짐 → 접기
    syncDateInputs(); render(); fetchWeather();
  }

  function init() {
    loadFav();
    loadChecks();
    var wk = PRESETS.week();            // 기본 = 이번 주말 (예보 범위 안)
    state.start = wk.start; state.end = wk.end;
    state.ctrlOpen = !isNarrow();       // 모바일은 접힌 채로 시작(결과가 바로 보이게)
    $("startInp").addEventListener("change", onStartChange);
    $("endInp").addEventListener("change", onEndChange);
    $("sortSel").addEventListener("change", function (e) { state.sort = e.target.value; applyCtrlState(); renderList(); });
    $("ctrlToggle").addEventListener("click", function () { state.ctrlOpen = !state.ctrlOpen; applyCtrlState(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    });
    $("backdrop").addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
    window.addEventListener("popstate", function () { if (sheetOpen) closeSheet(true); });
    syncDateInputs();
    render();
    fetchWeather();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.CC);
