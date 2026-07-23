/* ============================================================
   캠핑캐치 — predict.js
   "예약가능성 예측" 레이어. 실시간 자리(js/availability.js)가 없는
   캠핑장에도, 지금 있는 신호(주말·날씨·거리·규모·예약채널·계절)로
   "이 주말 자리 경쟁이 치열할까/여유로울까"를 미리 귀띔한다.
   ※ 이것은 '예측'이며, 실제 자리(🟢 실데이터)와는 구분해 표시한다.
   ============================================================ */
window.CC = window.CC || {};

(function (CC) {
  "use strict";

  /* 선택한 시작일이 '주말 성수'(금·토 체크인)인가 → 경쟁 최고 */
  CC.isWeekendStay = function (dstr) {
    try { var g = new Date(dstr + "T00:00:00").getDay(); return g === 5 || g === 6; }
    catch (e) { return false; }
  };

  /* 날씨 '좋음' 정도 0~1 (좋을수록 사람이 몰려 경쟁↑). 예보 있을 때만 반영. */
  function weatherNice(w) {
    if (!w) return null;                              // 예보 없음 → 반영 안 함
    var s = 1;
    s -= Math.min(w.pop, 100) / 100 * 0.7;            // 비 올 확률
    s -= (w.windSev || 0) * 0.18;                     // 바람(캠핑 핵심)
    if (w.codeSev >= 3) s -= 0.25;                    // 비/눈/뇌우
    if (w.tmax > 33 || w.tmin < -6) s -= 0.2;         // 폭염/혹한
    return Math.max(0, Math.min(1, s));
  }

  /* 예약 경쟁도 0~1 (높을수록 '자리 없을' 확률↑)
     — 캠핑장 간 '차이'가 드러나게: 거리·규모·계절인기·아이가 주 변별,
       주말/날씨는 완만한 가감으로만. */
  CC.demandScore = function (s, w, weekend, chan, season) {
    var d = 0.15;                                     // 기본
    d += weekend ? 0.12 : -0.03;                      // 주말/평일
    var nice = weatherNice(w);
    if (nice !== null) d += nice * 0.12;              // 좋은 날씨(예보 있을 때만)
    // 거리(가까울수록 수요 몰림) — 주 변별요소
    if (s.drive <= 40) d += 0.20;
    else if (s.drive <= 80) d += 0.10;
    else if (s.drive <= 120) d += 0.03;
    // 규모(작을수록 빨리 참)
    if (s.autoSite > 0 && s.autoSite <= 10) d += 0.14;
    else if (s.autoSite > 0 && s.autoSite <= 25) d += 0.07;
    // 계절 인기(태그 적합) — 여름 물놀이 등
    if (season && CC.seasonFit) d += Math.min(CC.seasonFit(s, season), 3) * 0.05;
    // 아이 좋은 곳(가족 수요)
    if (CC.kidPoints) d += Math.min(CC.kidPoints(s).length, 2) * 0.04;
    if (chan && chan.on) d += 0.05;                   // 온라인 즉시예약 = 빨리 참
    if (chan && chan.p === "phone_only") d -= 0.08;   // 전화만 = 경쟁 덜함
    return Math.max(0, Math.min(1, d));
  };

  /* 카드/상세용 예약가능성 힌트(예측). {level, txt, cls} */
  CC.availabilityHint = function (s, w, weekend, chan, season) {
    var d = CC.demandScore(s, w, weekend, chan, season);
    if (d >= 0.62) return { level: "tight", txt: "자리 치열 예상", emoji: "🔴", cls: "av-tight" };
    if (d >= 0.45) return { level: "mid",   txt: "경쟁 보통 예상", emoji: "🟡", cls: "av-mid" };
    return { level: "roomy", txt: "여유 있을 듯", emoji: "🟢", cls: "av-roomy" };
  };

})(window.CC);
