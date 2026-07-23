/* ============================================================
   캠핑캐치 — availability.js  (자동생성 · tools/build_availability.py)
   실시간 '진짜' 빈자리 데이터. 읽기가능(공공·자체) 캠핑장을 백엔드
   크롤러가 주기적으로 확인해 채운다.  CC.AVAIL[id] 가 있으면 카드가
   예측 대신 '🟢 자리있음 (N분 전)'을 실데이터로 표시한다.
     status: "open"(자리있음) | "full"(마감) | "few"(임박)
     remain: 남은 사이트 수(있으면)  · source: 출처  · date: 대상 날짜
     checkedAt: 확인 시각(ISO)
   ※ 현재는 골격(빈 상태). 크롤러 연동은 진행 중 — 채워지는 즉시 카드에 반영된다.
   ============================================================ */
window.CC = window.CC || {};
CC.AVAIL = CC.AVAIL || {};
CC.AVAIL_META = { generatedAt: null, weekend: null, note: "실시간 크롤러 연동 대기(읽기가능 공공·자체부터)" };
