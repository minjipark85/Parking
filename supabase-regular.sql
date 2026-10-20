-- ============================================================
--  정기 차량 표 추가 (이미 supabase.sql을 실행한 DB에 한 번만 실행)
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================

create table if not exists public.regular_vehicles (
  id          uuid primary key default gen_random_uuid(),
  plate       text not null,             -- 차량번호 (표시용, 예: 12가 3456)
  plate_key   text not null unique,      -- 차량번호 (공백 제거, 검색용, 예: 12가3456)
  memo        text,                      -- 소속·이름 등 (예: 관리사무소, 101동 홍길동)
  valid_from  date,                      -- 정기 등록 시작일 (비우면 제한 없음)
  valid_until date,                      -- 정기 등록 종료일 (비우면 무기한)
  created_at  timestamptz not null default now()
);

alter table public.regular_vehicles enable row level security;

-- 등록·수정·삭제는 Supabase 대시보드(Table Editor)에서 하세요.
-- 읽기 권한은 supabase-staff.sql 에서 "로그인한 직원"에게만 줍니다. (누구나 읽기는 열지 않음 — 다시 실행해도 안전)
drop policy if exists "read regular vehicles" on public.regular_vehicles;

-- 예시 데이터 (원하지 않으면 지우고 실행하세요)
insert into public.regular_vehicles (plate, plate_key, memo, valid_until) values
  ('11가 1111', '11가1111', '관리사무소', null),
  ('222나 3333', '222나3333', '협력업체 (연간)', current_date + 365)
on conflict (plate_key) do nothing;
