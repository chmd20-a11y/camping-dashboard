/* Supabase 설정 — 값이 채워지면 '요청 게시판'이 자동 활성화됩니다.
   anon(public) 키는 브라우저 공개용이라 커밋해도 안전합니다(RLS로 보호). */
window.CC = window.CC || {};
CC.SB = {
  url:  "",   // 예: https://abcdefgh.supabase.co
  anon: ""    // 예: eyJhbGciOiJIUzI1NiIsInR5cCI6... (anon public key)
};
