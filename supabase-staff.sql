-- ============================================================
--  직원 로그인 — 예약 표·정기 차량 표를 "직원 명단에 있는 계정"만 읽게 잠급니다.
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (다시 실행해도 안전)
--  ※ supabase.sql, supabase-regular.sql 을 먼저 실행한 DB에서 실행하세요.
--  ※ 신청 페이지(apply.html)는 영향 없습니다. (신청·남은 자리·내 예약은 별도 함수로 동작)
-- ============================================================

-- 1) 직원 명단 — Table Editor → staff_emails 에 직원 이메일을 한 줄씩 추가하세요.
create table if not exists public.staff_emails (
  email      text primary key,                 -- 로그인에 쓰는 이메일 (대소문자 구분 안 함)
  memo       text,                             -- 이름·근무지 등 (선택)
  created_at timestamptz not null default now()
);
alter table public.staff_emails enable row level security;   -- 정책 없음 = 웹에서 읽기·쓰기 불가
revoke all on public.staff_emails from anon, authenticated;

-- 2) 지금 로그인한 사람이 직원 명단에 있는지
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_emails
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

-- 3) 예약 표: 누구나 읽기 → 직원만 읽기
drop policy if exists "read reservations" on public.reservations;
drop policy if exists "staff read reservations" on public.reservations;
create policy "staff read reservations" on public.reservations
  for select to authenticated using ((select public.is_staff()));

-- 4) 정기 차량 표: 누구나 읽기 → 직원만 읽기
drop policy if exists "read regular vehicles" on public.regular_vehicles;
drop policy if exists "staff read regular vehicles" on public.regular_vehicles;
create policy "staff read regular vehicles" on public.regular_vehicles
  for select to authenticated using ((select public.is_staff()));

-- 5) 첫 직원 등록 예시 — 이메일을 바꿔서 실행하거나, Table Editor에서 줄을 추가하세요.
-- insert into public.staff_emails (email, memo) values ('staff@example.com', '정문 근무') on conflict do nothing;
