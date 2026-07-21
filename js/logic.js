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

  /* 예약처로 이동할 링크 (예약URL > 홈페이지 > 없음) */
  CC.reserveLink = function (s) {
    if (s.resveUrl) return { url: s.resveUrl, label: "예약처로 이동", kind: "resve" };
    if (s.homepage) return { url: s.homepage, label: "홈페이지 열기", kind: "home" };
    return null;
  };

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
