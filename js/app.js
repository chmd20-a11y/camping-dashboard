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

  var state = {
    start: "2026-08-15",  // 캠핑 기간 시작 (계절 추천 기준)
    end: "2026-08-16",    // 캠핑 기간 종료
    sort: "reco",
    regions: { "파주": false, "연천": false, "포천": false, "강원": false },  // 기본: 미선택 = 전체
    favorites: {}
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

  /* ---------- 필터 & 정렬 ---------- */
  function anyRegion() {
    return CC.REGION_META.some(function (r) { return state.regions[r.key]; });
  }
  // 지역 미선택 = 전체 표시
  function visibleSites() {
    if (!anyRegion()) return CC.SITES.slice();
    return CC.SITES.filter(function (s) { return state.regions[s.group]; });
  }
  function sortedSites() {
    var arr = visibleSites().slice();
    var d = state.start;
    if (state.sort === "reco")        arr.sort(function (a, b) { return CC.score(b, d) - CC.score(a, d); });
    else if (state.sort === "near")   arr.sort(function (a, b) { return a.drive - b.drive; });
    else if (state.sort === "auto")   arr.sort(function (a, b) { return b.autoSite - a.autoSite; });
    else if (state.sort === "season") arr.sort(function (a, b) { return CC.seasonFit(b, CC.seasonOf(d)) - CC.seasonFit(a, CC.seasonOf(d)) || CC.score(b, d) - CC.score(a, d); });
    var fav = arr.filter(isFav), rest = arr.filter(function (s) { return !isFav(s); });
    return fav.concat(rest);
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
      var c = document.createElement("button");
      c.className = "cur-card";
      c.innerHTML =
        '<div class="cur-thumb" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + (isFav(s) ? '<span class="cur-fav">⭐</span>' : '') + '</div>' +
        '<div class="cur-b"><div class="ct">' + esc(s.name) + '</div>' +
        '<div class="cr">' + CC.SEASON[season].emoji + ' ' + esc(CC.fitReason(s, season)) + '</div>' +
        '<div class="cm">' + esc(s.region) + ' · 🚗 ' + CC.driveTxt(s.drive) + '</div></div>';
      c.onclick = function () { openDetail(s.id); };
      row.appendChild(c);
    });
  }

  /* ---------- 랭킹 목록 ---------- */
  function renderList() {
    var arr = sortedSites();
    var season = CC.seasonOf(state.start);
    var list = $("list"); list.innerHTML = "";
    $("resultCount").textContent = arr.length + "곳 · " + CC.SEASON[season].label + " 추천순";

    if (!arr.length) {
      list.innerHTML = '<div class="empty"><div class="ee">🏕️</div><p>선택한 지역에 표시할 오토캠핑장이 없어요.<br>지역을 더 선택해 보세요.</p></div>';
      return;
    }

    arr.forEach(function (s, i) {
      var fav = isFav(s);
      var reason = CC.fitReason(s, season);
      var fit = CC.seasonFit(s, season) >= 1;
      var kid = CC.kidPoints(s).length > 0;

      var badges = "";
      if (fav) badges += '<span class="pill fav">⭐ 선호</span>';
      if (fit && reason) badges += '<span class="pill acc">' + CC.SEASON[season].emoji + ' ' + esc(reason) + '</span>';
      if (kid) badges += pill("👨‍👩‍👧 아이 좋아요", "kid");
      if (s.drive <= 40) badges += pill("가까움", "brand");
      if (s.resveUrl) badges += pill("온라인예약", "good");

      var autoTxt = s.autoSite > 0 ? ("오토 " + s.autoSite + "면") : "오토캠핑";

      var card = document.createElement("div");
      card.className = "site-card" + (fav ? " fav" : "");
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
        '</div>';

      card.onclick = function () { openDetail(s.id); };
      card.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(s.id); } };
      var fb = card.querySelector(".fav-btn");
      fb.onclick = function (e) { e.stopPropagation(); toggleFav(s.id); };
      fb.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); } };
      list.appendChild(card);
    });
  }

  function render() { renderRegions(); renderBanner(); renderCuration(); renderList(); }

  /* ---------- 상세 시트 ---------- */
  function openDetail(id) {
    var s = CC.SITES.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var season = CC.seasonOf(state.start);
    var reason = CC.fitReason(s, season);
    var fit = CC.seasonFit(s, season) >= 1;
    var fav = isFav(s);
    var kp = CC.kidPoints(s);
    var rl = CC.reserveLink(s);

    var heroImg = s.img
      ? '<img class="hero-img" src="' + esc(s.img) + '" alt="" onerror="this.remove()">'
      : '';

    var actions = "";
    if (rl) actions += '<a class="cta pri" href="' + esc(rl.url) + '" target="_blank" rel="noopener">' + rl.label + ' ↗</a>';
    else if (s.tel) actions += '<a class="cta pri" href="tel:' + esc(s.tel) + '">전화 예약 ' + esc(s.tel) + '</a>';
    actions += '<a class="cta sec" href="' + esc(CC.reviewLink(s)) + '" target="_blank" rel="noopener">네이버 후기</a>';

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
        '<div class="blk-h">시설 · 환경</div>' +
        '<div class="tagrow">' + (s.tags.length ? s.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("") : '<span class="tag">정보 준비중</span>') + '</div>' +
        '<div class="src-note">🗓️ 선택 기간 <b>' + periodTxt() + '</b> · 이 기간의 실시간 빈자리·가격·후기는 고캠핑 정보엔 없어요. 아래 예약처에서 확인하세요.</div>' +
        '<div class="cta-row">' + actions + '</div>' +
        '<div class="cta-row second"><a class="cta ghost" href="' + esc(CC.mapLink(s)) + '" target="_blank" rel="noopener">🧭 김포에서 길찾기</a></div>' +
      '</div>';

    $("sheetClose").onclick = closeSheet;
    $("sheetFav").onclick = function () { toggleFav(s.id); openDetail(s.id); };

    $("backdrop").classList.add("show");
    var sh = $("sheet"); sh.classList.add("show"); sh.scrollTop = 0;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    $("sheet").classList.remove("show");
    $("backdrop").classList.remove("show");
    document.body.style.overflow = "";
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
    $("endInp").value = state.end;
    $("endInp").min = addDays(state.start, 1);   // 종료일은 시작일 다음날부터
    $("startInp").max = state.end;
  }
  function onStartChange(e) {
    if (!e.target.value) { e.target.value = state.start; return; }
    state.start = e.target.value;
    if (ymdToDate(state.end) <= ymdToDate(state.start)) state.end = addDays(state.start, 1);  // 최소 1박 보장
    syncDateInputs(); render();
  }
  function onEndChange(e) {
    if (!e.target.value) { e.target.value = state.end; return; }
    state.end = e.target.value;
    if (ymdToDate(state.end) <= ymdToDate(state.start)) state.start = addDays(state.end, -1);
    syncDateInputs(); render();
  }

  function init() {
    loadFav();
    $("startInp").addEventListener("change", onStartChange);
    $("endInp").addEventListener("change", onEndChange);
    $("sortSel").addEventListener("change", function (e) { state.sort = e.target.value; renderList(); });
    $("backdrop").addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
    syncDateInputs();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.CC);
