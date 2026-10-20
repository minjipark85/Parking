-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요.

create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  reserve_date date not null,          -- 예약일자
  reserve_time time not null           -- 예약시간대 시작 시각
    check (reserve_time in ('09:00', '12:00', '15:00')),
                                       --   09:00 = 09:00~12:00
                                       --   12:00 = 12:00~15:00
                                       --   15:00 = 15:00~18:00
  plate        text not null,          -- 차량번호 (표시용, 예: 12가 3456)
  plate_key    text not null,          -- 차량번호 (공백 제거, 검색용, 예: 12가3456)
  created_at   timestamptz not null default now(),
  unique (plate_key, reserve_date, reserve_time)
);

create index if not exists reservations_plate_key_idx on public.reservations (plate_key);
create index if not exists reservations_date_idx on public.reservations (reserve_date, reserve_time);

-- 행 단위 보안(RLS) 켜기
alter table public.reservations enable row level security;

-- 읽기 권한은 supabase-staff.sql 에서 "로그인한 직원"에게만 줍니다. (여기서는 누구나 읽기를 열지 않음)
-- 예전 버전으로 만든 "누구나 읽기" 정책이 남아 있으면 지움 — 이 파일을 다시 실행해도 안전
drop policy if exists "read reservations" on public.reservations;

-- 예시 데이터 (원하지 않으면 지우고 실행하세요)
insert into public.reservations (reserve_date, reserve_time, plate, plate_key) values
  (current_date,     '09:00', '12가 3456',     '12가3456'),
  (current_date,     '15:00', '123나 4567',    '123나4567'),
  (current_date + 1, '12:00', '서울34다 7890', '서울34다7890')
on conflict do nothing;


-- ============================================================
--  정기 차량 (사전 예약과 상관없이 등록 기간 동안 항상 출입 가능)
-- ============================================================
create table if not exists public.regular_vehicles (
  id          uuid primary key default gen_random_uuid(),
  plate       text not null,             -- 차량번호 (표시용)
  plate_key   text not null unique,      -- 차량번호 (공백 제거, 검색용)
  memo        text,                      -- 소속·이름 등
  valid_from  date,                      -- 정기 등록 시작일 (비우면 제한 없음)
  valid_until date,                      -- 정기 등록 종료일 (비우면 무기한)
  created_at  timestamptz not null default now()
);

alter table public.regular_vehicles enable row level security;
drop policy if exists "read regular vehicles" on public.regular_vehicles;   -- 읽기는 supabase-staff.sql 에서 직원에게만

insert into public.regular_vehicles (plate, plate_key, memo, valid_until) values
  ('11가 1111', '11가1111', '관리사무소', null),
  ('222나 3333', '222나3333', '협력업체 (연간)', current_date + 365)
on conflict (plate_key) do nothing;
