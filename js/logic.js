/* ============================================================
   캠핑캐치 — logic.js
   데이터에만 의존하는 순수 계산 로직 (화면과 분리)
   - 계절 판별 / 요금 유형 / 자리 조회 / 계절 적합도 / 순위 점수
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

  /* 조회일 → 요금 유형 (7·8월=성수기, 금·토·일=주말, 그 외=주중) */
  CC.nightInfo = function (dstr) {
    var d = new Date(dstr + "T00:00:00");
    var m = d.getMonth() + 1, wd = d.getDay();
    if (m === 7 || m === 8) return { key: "pk", label: "성수기" };
    if (wd === 0 || wd === 5 || wd === 6) return { key: "we", label: "주말" };
    return { key: "wd", label: "주중" };
  };

  CC.priceOf = function (s, dstr) { return s[CC.nightInfo(dstr).key]; };

  /* 문자열 해시 (자리 현황을 날짜별로 일관되게 생성하기 위한 시드) */
  CC.hashStr = function (str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  };

  /* 조회일 예약 가능 자리 수 (0 = 마감). 데모용 의사난수 — 같은 날짜엔 항상 동일 */
  CC.availOf = function (s, dstr) {
    var r = CC.hashStr(dstr + "#" + s.id) % 10;
    return r < 3 ? 0 : (r - 2);
  };

  /* 계절 적합도 = 캠핑장 태그 중 해당 계절 want 태그와 겹치는 개수 */
  CC.seasonFit = function (s, season) {
    var want = CC.SEASON[season].want, n = 0;
    for (var i = 0; i < s.tags.length; i++) { if (want.indexOf(s.tags[i]) >= 0) n++; }
    return n;
  };

  /* 계절 적합 이유 텍스트 (매칭 태그 상위 3개) */
  CC.fitReason = function (s, season) {
    var want = CC.SEASON[season].want, hit = [];
    for (var i = 0; i < s.tags.length; i++) { if (want.indexOf(s.tags[i]) >= 0) hit.push(s.tags[i]); }
    return hit.slice(0, 3).join(" · ");
  };

  /* 순위 점수 = 후기(기준) + 자리(필수·큰 가점) + 계절(가점) − 이동시간(페널티) */
  CC.score = function (s, dstr) {
    var season = CC.seasonOf(dstr);
    var avail = CC.availOf(s, dstr);
    var sc = s.rating * 10;                    // 후기 점수 (기준)
    sc += Math.min(s.reviews / 100, 5);        // 후기 수 보정 (최대 +5)
    sc += avail > 0 ? 25 : 0;                   // 조회일 자리 있으면 큰 가점
    sc += CC.seasonFit(s, season) * 4;          // 계절 적합 가점
    sc -= (s.drive / 60) * 3;                    // 이동시간 페널티
    return sc;
  };

  /* ---------- 가족캠핑 ---------- */
  /* 아이 동반 가족캠핑 가능 여부 (false = 노키즈존/커플 전용 → 목록에서 제외) */
  CC.isFamily = function (s) { return s.family !== false; };

  /* 아이에게 좋은 포인트 태그 (상세에서 강조) */
  CC.KID_TAGS = ["물놀이", "수영장", "놀이터", "잔디", "계곡", "개수대"];
  CC.kidPoints = function (s) {
    return s.tags.filter(function (t) { return CC.KID_TAGS.indexOf(t) >= 0; }).slice(0, 3);
  };

  /* ---------- 표시 헬퍼 ---------- */
  CC.won = function (n) { return "₩" + n.toLocaleString("ko-KR"); };

  CC.driveTxt = function (min) {
    if (min < 60) return min + "분";
    var h = Math.floor(min / 60), m = min % 60;
    return h + "시간" + (m ? (" " + m + "분") : "");
  };

  /* 로컬 기준 YYYY-MM-DD (toISOString의 UTC 변환 오프바이원 방지) */
  CC.ymd = function (d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  };

  /* 대표 이모지 / 썸네일 배경 (태그 기반) */
  CC.thumbFor = function (s) {
    var t = s.tags;
    if (t.indexOf("바다") >= 0) return "🌊";
    if (t.indexOf("눈") >= 0 || t.indexOf("설경") >= 0) return "❄️";
    if (t.indexOf("수영장") >= 0) return "🏊";
    if (t.indexOf("계곡") >= 0 || t.indexOf("물놀이") >= 0 || t.indexOf("강변") >= 0 || t.indexOf("호수") >= 0) return "🏞️";
    if (t.indexOf("벚꽃") >= 0 || t.indexOf("꽃") >= 0) return "🌸";
    if (t.indexOf("단풍") >= 0) return "🍁";
    if (t.indexOf("온돌데크") >= 0 || t.indexOf("난방") >= 0) return "🔥";
    if (t.indexOf("숲") >= 0 || t.indexOf("그늘") >= 0) return "🌲";
    return "⛺";
  };

  CC.thumbBg = function (s) {
    var t = s.tags;
    if (t.indexOf("바다") >= 0 || t.indexOf("계곡") >= 0 || t.indexOf("물놀이") >= 0 ||
        t.indexOf("강변") >= 0 || t.indexOf("호수") >= 0 || t.indexOf("수영장") >= 0)
      return "linear-gradient(135deg,#cfe6ec,#a9d3dd)";
    if (t.indexOf("눈") >= 0 || t.indexOf("설경") >= 0)
      return "linear-gradient(135deg,#e5edf2,#c9d8e2)";
    if (t.indexOf("벚꽃") >= 0 || t.indexOf("꽃") >= 0)
      return "linear-gradient(135deg,#f5dbe4,#eec4d3)";
    if (t.indexOf("단풍") >= 0 || t.indexOf("온돌데크") >= 0 || t.indexOf("난방") >= 0)
      return "linear-gradient(135deg,#f3ddc6,#e9c5a3)";
    return "linear-gradient(135deg,#d8e8dc,#bcd8c4)";
  };

})(window.CC);
