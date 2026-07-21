/* ============================================================
   캠핑캐치 — logic.js
   실데이터(sites.js) 기반 계산 로직 (화면과 분리)
   ※ 고캠핑 API엔 후기·가격·실시간 자리가 없어, 이용 가능한 실제 신호
     (계절 적합·시설·오토 규모·온라인예약·거리)로 '추천순'을 만든다.
     후기 연동은 2단계(백엔드) 과제.
   ============================================================ */
window.CC = window.CC || {};

(function (CC) {
  "use strict";

  /* 조회일(YYYY-MM-DD) → 계절 키 */
  CC.seasonOf = function (dstr) {
    var m = parseInt(dstr.slice(5, 7), 10);
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  };

  /* 계절 적합도 = 캠핑장 태그 중 해당 계절 want 태그와 겹치는 개수 */
  CC.seasonFit = function (s, season) {
    var want = CC.SEASON[season].want, n = 0;
    for (var i = 0; i < s.tags.length; i++) { if (want.indexOf(s.tags[i]) >= 0) n++; }
    return n;
  };
  CC.fitReason = function (s, season) {
    var want = CC.SEASON[season].want, hit = [];
    for (var i = 0; i < s.tags.length; i++) { if (want.indexOf(s.tags[i]) >= 0) hit.push(s.tags[i]); }
    return hit.slice(0, 3).join(" · ");
  };

  /* 아이에게 좋은 포인트 */
  CC.kidPoints = function (s) {
    return s.tags.filter(function (t) { return CC.KID_TAGS.indexOf(t) >= 0; });
  };

  /* 추천 점수 = 계절적합 + 시설충실 + 오토규모 + 아이 + 온라인예약 − 거리 */
  CC.score = function (s, dstr) {
    var season = CC.seasonOf(dstr);
    var sc = CC.seasonFit(s, season) * 8;              // 계절 적합 (핵심)
    sc += Math.min(s.tags.length, 8) * 1.2;            // 시설/특성 충실도
    sc += Math.min(s.autoSite, 60) / 12;               // 오토 규모 (최대 +5)
    sc += CC.kidPoints(s).length * 3;                  // 아이 좋은 곳 가점
    sc += s.resveUrl ? 3 : 0;                           // 온라인 예약 가능 가점
    sc -= (s.drive / 60) * 4;                           // 이동시간 페널티
    return sc;
  };

  /* ---------- 표시 헬퍼 ---------- */
  CC.driveTxt = function (min) {
    if (min < 60) return min + "분";
    var h = Math.floor(min / 60), m = min % 60;
    return h + "시간" + (m ? (" " + m + "분") : "");
  };

  /* ---------- 날씨 (Open-Meteo · 무키 · CORS 허용) ----------
     캠핑엔 '바람'이 비보다 치명적 → 풍속을 1급 지표로 두고 강풍을 크게 감점.
     예보는 D-16 이내만 신뢰 → 그 밖은 정렬에 쓰지 않음(없는 정밀도 만들지 않기). */
  /* WMO weather_code → 표시정보 (sev: 0 좋음 … 3 궂음) */
  CC.WX = {
    0:{e:"☀️",l:"맑음",sev:0}, 1:{e:"🌤️",l:"대체로 맑음",sev:0}, 2:{e:"⛅",l:"구름 조금",sev:1}, 3:{e:"☁️",l:"흐림",sev:1},
    45:{e:"🌫️",l:"안개",sev:1}, 48:{e:"🌫️",l:"짙은 안개",sev:1},
    51:{e:"🌦️",l:"약한 이슬비",sev:2}, 53:{e:"🌦️",l:"이슬비",sev:2}, 55:{e:"🌧️",l:"짙은 이슬비",sev:2}, 56:{e:"🌧️",l:"어는 이슬비",sev:2}, 57:{e:"🌧️",l:"어는 이슬비",sev:2},
    61:{e:"🌧️",l:"약한 비",sev:2}, 63:{e:"🌧️",l:"비",sev:3}, 65:{e:"🌧️",l:"강한 비",sev:3}, 66:{e:"🌧️",l:"어는 비",sev:3}, 67:{e:"🌧️",l:"강한 어는 비",sev:3},
    71:{e:"🌨️",l:"약한 눈",sev:2}, 73:{e:"🌨️",l:"눈",sev:3}, 75:{e:"❄️",l:"강한 눈",sev:3}, 77:{e:"🌨️",l:"싸락눈",sev:2},
    80:{e:"🌦️",l:"약한 소나기",sev:2}, 81:{e:"🌧️",l:"소나기",sev:3}, 82:{e:"⛈️",l:"강한 소나기",sev:3},
    85:{e:"🌨️",l:"약한 눈소나기",sev:2}, 86:{e:"❄️",l:"강한 눈소나기",sev:3},
    95:{e:"⛈️",l:"뇌우",sev:3}, 96:{e:"⛈️",l:"뇌우·우박",sev:3}, 99:{e:"⛈️",l:"강한 뇌우·우박",sev:3}
  };
  CC.wxInfo = function (code) { return CC.WX[code] || { e:"🌡️", l:"—", sev:1 }; };

  /* 캠핑 기준 바람 위험도 (m/s) */
  CC.windSev = function (wind, gust) {
    var w = wind || 0, g = gust || 0;
    if (w >= 11 || g >= 20) return 3;   // 설영 위험
    if (w >= 8  || g >= 14) return 2;   // 타프 주의
    if (w >= 5  || g >= 10) return 1;   // 약간 바람
    return 0;                            // 잔잔
  };
  CC.WIND_LABEL = ["잔잔", "약풍", "강풍 주의", "강풍 위험"];

  /* 여러 날 예보(daily) → 여행 전체 대표값 (비확률·바람은 '가장 나쁜 날' 기준) */
  CC.wxAggregate = function (daily) {
    if (!daily || !daily.time || !daily.time.length) return null;
    var code = daily.weather_code || [], tx = daily.temperature_2m_max || [], tn = daily.temperature_2m_min || [],
        pp = daily.precipitation_probability_max || [], ws = daily.wind_speed_10m_max || [], wg = daily.wind_gusts_10m_max || [];
    var tmax = -99, tmin = 99, pop = 0, wind = 0, gust = 0, worst = null, worstSev = -1, n = daily.time.length;
    for (var i = 0; i < n; i++) {
      if (typeof tx[i] === "number") tmax = Math.max(tmax, tx[i]);
      if (typeof tn[i] === "number") tmin = Math.min(tmin, tn[i]);
      if (typeof pp[i] === "number") pop = Math.max(pop, pp[i]);
      if (typeof ws[i] === "number") wind = Math.max(wind, ws[i]);
      if (typeof wg[i] === "number") gust = Math.max(gust, wg[i]);
      var info = CC.wxInfo(code[i]);
      if (info.sev > worstSev) { worstSev = info.sev; worst = info; }
    }
    if (!worst) return null;
    return {
      emoji: worst.e, label: worst.l, codeSev: worst.sev,
      tmax: Math.round(tmax), tmin: Math.round(tmin), pop: Math.round(pop),
      wind: Math.round(wind), gust: Math.round(gust), windSev: CC.windSev(wind, gust)
    };
  };

  /* 정렬용 날씨 점수 (예보 신뢰구간에서만 사용) — 바람 가중 */
  CC.wxScore = function (w) {
    if (!w) return 0;
    var s = 0;
    s -= (w.pop / 100) * 7;                // 비 올 확률
    s -= Math.max(0, w.wind - 4) * 1.4;    // 바람(4m/s 초과분) — 캠핑 핵심
    s -= Math.max(0, w.gust - 10) * 0.5;   // 돌풍
    s -= w.codeSev * 0.8;                  // 비/눈/뇌우 심각도
    return s;
  };

  /* 표시 헬퍼 */
  CC.wxClass   = function (w) { if (!w) return ""; if (w.pop >= 60 || w.codeSev >= 3) return "bad"; if (w.pop >= 30 || w.codeSev >= 2) return "mid"; return "good"; };
  CC.wxText    = function (w) { return w ? (w.emoji + " " + w.tmax + "° · 비" + w.pop + "%") : ""; };
  CC.windClass = function (w) { return w ? ["good", "mid", "bad", "bad"][w.windSev] : ""; };
  CC.windText  = function (w) { if (!w) return ""; var t = "💨 " + w.wind + "m/s"; if (w.gust >= w.wind + 3) t += " 돌풍" + w.gust; return t; };

  /* 문자열이 실제 URL이면 정규화해 반환, 아니면 "" (고캠핑 데이터엔 "캠핏 or 네이버" 같은 텍스트가 섞여 있음) */
  CC.normUrl = function (v) {
    if (!v) return "";
    v = String(v).trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w.-]+\.[a-z]{2,}([\/?#]|$)/i.test(v)) return "https://" + v;  // 프로토콜 없는 도메인
    return "";  // URL 아님(설명 텍스트 등)
  };

  /* 예약URL이 캠핑장별 예약 페이지(달력)로 보이는지 / 일반 랜딩(홈)인지 */
  CC.reserveKind = function (s) {
    var u = CC.normUrl(s.resveUrl);
    if (!u) return "none";
    try {
      var p = new URL(u);
      var hasPath = (p.pathname && p.pathname.replace(/\/+$/, "") !== "") || !!p.search;
      return hasPath ? "calendar" : "landing";  // 경로/쿼리 있으면 캠핑장 예약 페이지로 간주
    } catch (e) { return "landing"; }
  };

  /* 검증(tools/check_links.py)에서 죽은 걸로 확인된 링크인지 — 죽었으면 false */
  CC.linkOk = function (id, field) {
    var m = CC.LINK && CC.LINK[id];
    if (!m) return true;
    return m[field === "resveUrl" ? "r" : "h"] !== 0;
  };
  /* 실제로 열어도 되는(살아있는) 예약 URL만 반환 */
  CC.liveResveUrl = function (s) {
    var r = CC.normUrl(s.resveUrl);
    return (r && CC.linkOk(s.id, "resveUrl")) ? r : "";
  };

  /* 예약 이동 링크 — 살아있는 캠핑장 예약 캘린더 > 홈 > 네이버 '○○ 예약' 검색 */
  CC.reserveLink = function (s) {
    var r = CC.liveResveUrl(s);
    if (r) {
      var cal = CC.reserveKind(s) === "calendar";
      return { url: r, label: cal ? "🗓️ 예약 캘린더 열기" : "예약처로 이동", direct: true, calendar: cal };
    }
    return {
      url: "https://search.naver.com/search.naver?query=" + encodeURIComponent(s.name + " 예약"),
      label: "예약 검색 (네이버)", direct: false, calendar: false
    };
  };

  /* 예약URL이 URL이 아니라 설명 텍스트일 때 그 힌트(예: "캠핏 or 네이버") */
  CC.reserveHint = function (s) {
    var v = (s.resveUrl || "").replace(/\s+/g, " ").trim();
    return (v && !CC.normUrl(v)) ? v : "";
  };

  /* 유효한(살아있는) 홈페이지 URL (없으면 "") */
  CC.homeLink = function (s) { var u = CC.normUrl(s.homepage); return (u && CC.linkOk(s.id, "homepage")) ? u : ""; };

  /* 온라인 예약 가능 = 살아있는 예약URL이 있는 곳 (죽은 링크는 제외) */
  CC.hasRealtime = function (s) { return !!CC.liveResveUrl(s); };

  /* 네이버 후기 검색 링크 (실제 후기 확인용 링크아웃) */
  CC.reviewLink = function (s) {
    return "https://search.naver.com/search.naver?query=" + encodeURIComponent(s.name + " 캠핑장 후기");
  };

  /* 카카오맵 길찾기 (김포 → 캠핑장) */
  CC.mapLink = function (s) {
    return "https://map.kakao.com/link/to/" + encodeURIComponent(s.name) + "," + s.lat + "," + s.lng;
  };

  /* 대표 이모지 / 썸네일 배경 (태그 기반) */
  CC.thumbFor = function (s) {
    var t = s.tags;
    if (t.indexOf("바다") >= 0) return "🌊";
    if (t.indexOf("눈") >= 0) return "❄️";
    if (t.indexOf("수영장") >= 0 || t.indexOf("물놀이장") >= 0) return "🏊";
    if (t.indexOf("계곡") >= 0 || t.indexOf("물놀이") >= 0 || t.indexOf("호수") >= 0 || t.indexOf("낚시") >= 0) return "🏞️";
    if (t.indexOf("벚꽃") >= 0) return "🌸";
    if (t.indexOf("단풍") >= 0) return "🍁";
    if (t.indexOf("숲") >= 0) return "🌲";
    if (t.indexOf("산") >= 0) return "⛰️";
    return "⛺";
  };
  CC.thumbBg = function (s) {
    var t = s.tags;
    if (t.indexOf("바다") >= 0 || t.indexOf("계곡") >= 0 || t.indexOf("물놀이") >= 0 ||
        t.indexOf("호수") >= 0 || t.indexOf("수영장") >= 0 || t.indexOf("물놀이장") >= 0 || t.indexOf("낚시") >= 0)
      return "linear-gradient(135deg,#cfe6ec,#a9d3dd)";
    if (t.indexOf("눈") >= 0) return "linear-gradient(135deg,#e5edf2,#c9d8e2)";
    if (t.indexOf("벚꽃") >= 0) return "linear-gradient(135deg,#f5dbe4,#eec4d3)";
    if (t.indexOf("단풍") >= 0) return "linear-gradient(135deg,#f3ddc6,#e9c5a3)";
    return "linear-gradient(135deg,#d8e8dc,#bcd8c4)";
  };

})(window.CC);
