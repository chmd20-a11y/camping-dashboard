-- ============================================================
-- 캠핑캐치 요청 게시판 — Supabase 초기 설정 SQL
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행(Run).
--   · 누구나: 요청/댓글 작성·읽기 (로그인 불필요)
--   · 관리자(로그인): 상태 변경(요청→진행중→완료), 삭제
-- ============================================================

-- 1) 요청 테이블
create table if not exists public.requests (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  author     text not null default '익명',
  title      text not null,
  body       text not null default '',
  status     text not null default '요청' check (status in ('요청','진행중','완료'))
);

-- 2) 댓글 테이블
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  request_id bigint not null references public.requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  author     text not null default '익명',
  body       text not null,
  is_admin   boolean not null default false
);

-- 3) 관리자 댓글 표시: 로그인 여부를 서버가 직접 스탬프(클라 위조 방지)
create or replace function public.stamp_is_admin()
returns trigger language plpgsql as $$
begin
  new.is_admin := (auth.role() = 'authenticated');
  return new;
end $$;
drop trigger if exists trg_stamp_is_admin on public.comments;
create trigger trg_stamp_is_admin before insert on public.comments
  for each row execute function public.stamp_is_admin();

-- 4) RLS 활성화
alter table public.requests enable row level security;
alter table public.comments enable row level security;

-- 5) 접근 정책
-- 읽기: 누구나
create policy "read_requests" on public.requests for select using (true);
create policy "read_comments" on public.comments for select using (true);
-- 요청 작성: 누구나(신규는 status='요청'으로 강제)
create policy "insert_requests" on public.requests for insert with check (status = '요청');
-- 댓글 작성: 누구나
create policy "insert_comments" on public.comments for insert with check (true);
-- 상태 변경(완료 처리 등): 로그인한 관리자만
create policy "update_requests_admin" on public.requests for update
  using (auth.role() = 'authenticated') with check (true);
-- 삭제(정리용): 관리자만
create policy "delete_requests_admin" on public.requests for delete using (auth.role() = 'authenticated');
create policy "delete_comments_admin" on public.comments for delete using (auth.role() = 'authenticated');

-- ============================================================
-- 실행 후 대시보드에서:
--   ① Authentication → Users → Add user 로 '관리자' 계정 생성
--      (본인 이메일 + 비밀번호, Auto Confirm User 체크)
--   ② Authentication → Sign In / Providers → Email 의
--      "Allow new users to sign up" 끄기 (관리자 외 가입 차단)
--   ③ Project Settings → API 에서 Project URL 과 anon public key 복사
-- ============================================================
