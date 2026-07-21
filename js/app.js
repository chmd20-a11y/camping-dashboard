/* ============================================================
   캠핑캐치 — app.js
   상태 관리 + 화면 렌더링 + 이벤트 (CC.* 로직 사용)
   ============================================================ */
window.CC = window.CC || {};

(function (CC) {
  "use strict";

  var state = {
    date: "2026-08-15",   // 기본 조회일(여름 · 계절 추천이 바로 보이도록)
    nights: 1,
    sort: "reco",
    regions: { "파주": true, "연천": true, "포천": true, "강원": true },
    alerts: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 필터 & 정렬 ---------- */
  function visibleSites() {
    return CC.SITES.filter(function (s) { return state.regions[s.group]; });
  }
  function sortedSites() {
    var arr = visibleSites().slice();
    var d = state.date;
    if (state.sort === "reco")        arr.sort(function (a, b) { return CC.score(b, d) - CC.score(a, d); });
    else if (state.sort === "rating") arr.sort(function (a, b) { return (b.rating - a.rating) || (b.reviews - a.reviews); });
    else if (state.sort === "near")   arr.sort(function (a, b) { return a.drive - b.drive; });
    else if (state.sort === "price")  arr.sort(function (a, b) { return CC.priceOf(a, d) - CC.priceOf(b, d); });
    return arr;
  }

  function badge(text, cls) { return '<span class="pill ' + cls + '"><span class="dot"></span>' + text + '</span>'; }

  /* ---------- 지역 필터 ---------- */
  function renderRegions() {
    var row = $("regionRow"); row.innerHTML = "";
    CC.REGION_META.forEach(function (r) {
      var b = document.createElement("button");
      b.className = "rchip" + (state.regions[r.key] ? " on" : "");
      b.innerHTML = r.key + '<span class="rd">' + r.d + '</span>';
      b.setAttribute("aria-pressed", state.regions[r.key] ? "true" : "false");
      b.onclick = function () {
        var on = Object.keys(state.regions).filter(function (k) { return state.regions[k]; });
        if (state.regions[r.key] && on.length === 1) { toast("최소 한 개 지역은 선택해 주세요"); return; }
        state.regions[r.key] = !state.regions[r.key];
        render();
      };
      row.appendChild(b);
    });
  }

  /* ---------- 계절 배너 ---------- */
  function renderBanner() {
    var s = CC.SEASON[CC.seasonOf(state.date)];
    var ni = CC.nightInfo(state.date);
    $("seasonBanner").innerHTML =
      '<span class="se">' + s.emoji + '</span>' +
      '<div><div class="sb-t">' + s.label + ' 시즌 · ' + ni.label + ' 요금</div>' +
      '<div class="sb-d">지금은 <b>' + s.desc + '</b>을(를) 우선 추천합니다.</div></div>';
    $("curTitle").textContent = s.emoji + " 이 계절(" + s.label + ") 추천";
  }

  /* ---------- 계절 큐레이션 ---------- */
  function renderCuration() {
    var season = CC.seasonOf(state.date);
    var picks = visibleSites().slice().sort(function (a, b) {
      var fa = CC.seasonFit(a, season), fb = CC.seasonFit(b, season);
      var aa = CC.availOf(a, state.date) > 0 ? 1 : 0, ab = CC.availOf(b, state.date) > 0 ? 1 : 0;
      return (fb - fa) || (ab - aa) || (b.rating - a.rating);
    }).filter(function (s) { return CC.seasonFit(s, season) > 0; }).slice(0, 5);

    var row = $("curRow"); row.innerHTML = "";
    if (!picks.length) {
      row.innerHTML = '<div style="color:var(--muted);font-size:.82rem;padding:8px 2px;">이 지역·계절 조합에 딱 맞는 추천이 아직 없어요.</div>';
      return;
    }
    picks.forEach(function (s) {
      var reason = CC.fitReason(s, season);
      var av = CC.availOf(s, state.date);
      var c = document.createElement("button");
      c.className = "cur-card";
      c.innerHTML =
        '<div class="cur-thumb" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + '</div>' +
        '<div class="cur-b"><div class="ct">' + s.name + '</div>' +
        '<div class="cr">' + CC.SEASON[season].emoji + ' ' + reason + '</div>' +
        '<div class="cm">★' + s.rating.toFixed(1) + ' · ' + s.region + ' · ' + (av > 0 ? ('자리 ' + av) : '마감') + '</div></div>';
      c.onclick = function () { openDetail(s.id); };
      row.appendChild(c);
    });
  }

  /* ---------- 랭킹 목록 ---------- */
  function renderList() {
    var arr = sortedSites();
    var season = CC.seasonOf(state.date);
    var list = $("list"); list.innerHTML = "";
    $("resultCount").textContent = arr.length + "곳 · " + CC.SEASON[season].label + " · " + CC.nightInfo(state.date).label;

    if (!arr.length) {
      list.innerHTML = '<div class="empty"><div class="ee">🏕️</div><p>선택한 지역에 표시할 오토캠핑장이 없어요.<br>지역을 더 선택해 보세요.</p></div>';
      return;
    }

    arr.forEach(function (s, i) {
      var av = CC.availOf(s, state.date);
      var closed = av === 0;
      var ni = CC.nightInfo(state.date);
      var reason = CC.fitReason(s, season);
      var fit = CC.seasonFit(s, season) >= 2;

      var badges = "";
      badges += closed ? badge("마감", "crit") : badge("자리 " + av + "곳", "good");
      if (fit && reason) badges += '<span class="pill acc">' + CC.SEASON[season].emoji + ' ' + reason + '</span>';
      if (s.drive <= 60) badges += badge("가까움", "brand");

      var card = document.createElement("button");
      card.className = "site-card" + (closed ? " closed" : "");
      card.setAttribute("aria-label", s.name + " 상세 보기");
      card.innerHTML =
        '<div class="sc-rank' + (closed ? ' dim' : '') + '">' + (i + 1) + '</div>' +
        '<div class="sc-thumb" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) + '</div>' +
        '<div class="sc-body">' +
          '<div class="sc-top"><span class="sc-name">' + s.name + '</span>' +
            '<span class="sc-price">' + CC.won(CC.priceOf(s, state.date)) + '<small>' + ni.label + ' / 박</small></span></div>' +
          '<div class="sc-meta"><span class="star">★ ' + s.rating.toFixed(1) + '</span>' +
            '<span>후기 ' + s.reviews + '</span><span class="sep">·</span><span>' + s.region + '</span>' +
            '<span class="sep">·</span><span>🚗 ' + CC.driveTxt(s.drive) + '</span></div>' +
          '<div class="sc-badges">' + badges + '</div>' +
        '</div>';
      card.onclick = function () { openDetail(s.id); };
      list.appendChild(card);
    });
  }

  function render() { renderRegions(); renderBanner(); renderCuration(); renderList(); }

  /* ---------- 상세 시트 ---------- */
  function openDetail(id) {
    var s = CC.SITES.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var season = CC.seasonOf(state.date);
    var ni = CC.nightInfo(state.date);
    var reason = CC.fitReason(s, season);
    var fit = CC.seasonFit(s, season) >= 2;

    // 조회일 + 이후 2일 자리
    var base = new Date(state.date + "T00:00:00");
    var acells = "";
    for (var k = 0; k < 3; k++) {
      var d = new Date(base.getTime() + k * 86400000);
      var ds = CC.ymd(d);
      var av = CC.availOf(s, ds);
      var mmdd = (d.getMonth() + 1) + "/" + d.getDate();
      acells += '<div class="acell ' + (av > 0 ? 'ok' : 'no') + '"><div class="ad">' + mmdd + '</div><div class="av">' + (av > 0 ? ('○ ' + av) : '마감') + '</div></div>';
    }

    // 태그 기반 후기 최대 3개
    var revs = "", rc = 0;
    for (var t = 0; t < s.tags.length && rc < 3; t++) {
      var msg = CC.TAG_REVIEW[s.tags[t]];
      if (msg) { revs += '<div class="rev"><span class="rstar">★ ' + (4.4 + ((s.id + t) % 6) / 10).toFixed(1) + '</span> ' + msg + '</div>'; rc++; }
    }

    var priceOn = ni.key;
    var alerted = !!state.alerts[s.id];
    var closed = CC.availOf(s, state.date) === 0;

    $("sheet").innerHTML =
      '<div class="sheet-grab"></div>' +
      '<div class="sheet-hero" style="background:' + CC.thumbBg(s) + '">' + CC.thumbFor(s) +
        '<button class="sheet-close" id="sheetClose" aria-label="닫기">✕</button></div>' +
      '<div class="sheet-b">' +
        '<h2>' + s.name + '</h2>' +
        '<div class="sheet-meta"><span class="star">★ ' + s.rating.toFixed(1) + '</span><span>후기 ' + s.reviews + '</span>' +
          '<span>·</span><span>' + s.region + '</span><span>·</span><span>🚗 김포에서 ' + CC.driveTxt(s.drive) + '</span></div>' +
        (fit && reason
          ? '<div class="season-note fit">' + CC.SEASON[season].emoji + ' ' + CC.SEASON[season].label + ' 추천 — ' + reason + '</div>'
          : '<div class="season-note">이 계절(' + CC.SEASON[season].label + ')엔 우선 추천 대상은 아니에요.</div>') +
        '<div class="blk-h">1박 가격</div>' +
        '<div class="ptable">' +
          '<div class="pcell' + (priceOn === "wd" ? " on" : "") + '"><div class="pl">주중</div><div class="pv">' + CC.won(s.wd) + '</div></div>' +
          '<div class="pcell' + (priceOn === "we" ? " on" : "") + '"><div class="pl">주말</div><div class="pv">' + CC.won(s.we) + '</div></div>' +
          '<div class="pcell' + (priceOn === "pk" ? " on" : "") + '"><div class="pl">성수기</div><div class="pv">' + CC.won(s.pk) + '</div></div>' +
        '</div>' +
        '<div class="blk-h">조회일 자리 (' + state.nights + '박 기준)</div>' +
        '<div class="avail-row">' + acells + '</div>' +
        '<div class="blk-h">시설·환경</div>' +
        '<div class="tagrow">' + s.tags.map(function (t) { return '<span class="tag">' + t + '</span>'; }).join("") + '</div>' +
        '<div class="blk-h">후기</div>' + revs +
        '<div class="cta-row">' +
          (closed
            ? '<button class="cta pri" id="ctaReserve">예약 페이지로 이동</button>' +
              '<button class="cta sec' + (alerted ? " on" : "") + '" id="ctaAlert">' + (alerted ? "알림 신청됨 ✓" : "🔔 취소표 알림") + '</button>'
            : '<button class="cta pri" id="ctaReserve">예약 페이지로 이동</button>') +
        '</div>' +
      '</div>';

    $("sheetClose").onclick = closeSheet;
    $("ctaReserve").onclick = function () { toast("데모: 실제 서비스에서는 이 캠핑장의 예약처로 연결됩니다"); };
    var ca = $("ctaAlert");
    if (ca) { ca.onclick = function () { toggleAlert(s.id); openDetail(s.id); }; }

    $("backdrop").classList.add("show");
    var sh = $("sheet"); sh.classList.add("show"); sh.scrollTop = 0;
    document.body.style.overflow = "hidden";
  }

  function closeSheet() {
    $("sheet").classList.remove("show");
    $("backdrop").classList.remove("show");
    document.body.style.overflow = "";
  }

  function toggleAlert(id) {
    state.alerts[id] = !state.alerts[id];
    toast(state.alerts[id] ? "취소표 알림을 신청했어요 (데모)" : "취소표 알림을 해제했어요");
  }

  /* ---------- 토스트 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ---------- 초기화 ---------- */
  function init() {
    $("dateInp").addEventListener("change", function (e) { if (e.target.value) { state.date = e.target.value; render(); } });
    $("nightsSel").addEventListener("change", function (e) { state.nights = parseInt(e.target.value, 10); });
    $("sortSel").addEventListener("change", function (e) { state.sort = e.target.value; renderList(); });
    $("backdrop").addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.CC);
