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

-- 확인 페이지는 조회만 합니다. (등록·수정·삭제 정책이 없으므로 페이지에서는 바꿀 수 없음)
-- 예약 등록은 Supabase 대시보드(Table Editor)나 별도 관리 시스템에서 합니다.
create policy "read reservations" on public.reservations for select using (true);

-- 예시 데이터 (원하지 않으면 지우고 실행하세요)
insert into public.reservations (reserve_date, reserve_time, plate, plate_key) values
  (current_date,     '09:00', '12가 3456',     '12가3456'),
  (current_date,     '15:00', '123나 4567',    '123나4567'),
  (current_date + 1, '12:00', '서울34다 7890', '서울34다7890')
on conflict do nothing;
