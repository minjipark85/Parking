-- ============================================================
--  예약 신청 페이지(apply.html)용 DB 설정
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (한 번만, 다시 실행해도 안전)
--  ※ supabase.sql(예약 표)과 supabase-regular.sql(정기 차량 표)을 먼저 실행한 DB에서 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 신청자 연락처 (비공개)
--    이름·연락처는 예약 표와 따로 저장하고, 웹페이지(anon 키)에서는 읽을 수 없게 잠급니다.
--    관리자는 Supabase 대시보드 Table Editor에서만 볼 수 있습니다.
-- ------------------------------------------------------------
create table if not exists public.reservation_contacts (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  name       text not null,
  phone      text not null,                -- 숫자만 저장 (예: 01012345678)
  created_at timestamptz not null default now()
);
alter table public.reservation_contacts enable row level security;
-- 정책을 만들지 않음 = 웹페이지에서 읽기·쓰기 모두 불가 (아래 함수를 통해서만 저장)
revoke all on public.reservation_contacts from anon, authenticated;

-- ------------------------------------------------------------
-- 2) 시간대별 정원
--    · 기본 정원: slot_capacity (시간대마다 200)
--    · 날짜별 정원: date_slot_capacity — 관리자 페이지(admin-7k2q.html)에서 날짜·시간대마다 바꿈
--    · 날짜별 정원이 있으면 그것을, 없으면 기본 정원을 씁니다. 0이면 그 시간대는 신청을 받지 않습니다.
-- ------------------------------------------------------------
create table if not exists public.slot_capacity (
  slot     time primary key check (slot in ('09:00', '12:00', '15:00')),
  capacity int  not null check (capacity >= 0)
);
insert into public.slot_capacity (slot, capacity) values
  ('09:00', 200), ('12:00', 200), ('15:00', 200)
on conflict (slot) do nothing;
update public.slot_capacity set capacity = 200 where capacity = 20;   -- 예전 기본값(20) → 200
alter table public.slot_capacity enable row level security;
drop policy if exists "read slot capacity" on public.slot_capacity;
create policy "read slot capacity" on public.slot_capacity for select using (true);

create table if not exists public.date_slot_capacity (
  open_date date not null,
  slot      time not null check (slot in ('09:00', '12:00', '15:00')),
  capacity  int  not null check (capacity between 0 and 100000),
  primary key (open_date, slot)
);
alter table public.date_slot_capacity enable row level security;     -- 정책 없음 = 관리자 함수로만 바꿈
revoke all on public.date_slot_capacity from anon, authenticated;

-- 그 날짜·시간대의 정원 (날짜별 → 기본 → 200)
create or replace function public.slot_cap(p_date date, p_slot time) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select capacity from date_slot_capacity where open_date = p_date and slot = p_slot),
    (select capacity from slot_capacity where slot = p_slot),
    200);
$$;
revoke all on function public.slot_cap(date, time) from public;

-- ------------------------------------------------------------
-- 3) 예약 가능한 날짜 — open_dates 표에 있는 날짜만 (관리자 페이지에서 열고 닫음)
--    처음에는 2026-10-24 ~ 11-22 토·일을 넣어 둡니다. 자세한 관리는 supabase-opendates.sql 참고.
-- ------------------------------------------------------------
create table if not exists public.open_dates (
  open_date  date primary key,
  opens_at   timestamptz,                 -- 비우면 바로 공개, 일시를 넣으면 그때부터 공개
  created_at timestamptz not null default now()
);
alter table public.open_dates enable row level security;
revoke all on public.open_dates from anon, authenticated;
insert into public.open_dates (open_date)
select d::date from generate_series(date '2026-10-24', date '2026-11-22', interval '1 day') d
 where extract(isodow from d) in (6, 7)
on conflict (open_date) do nothing;

create or replace function public.apply_date_allowed(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from open_dates
                  where open_date = p_date and (opens_at is null or opens_at <= now()));
$$;
drop function if exists public.apply_max_days();     -- 예전 규칙(오늘~30일) 삭제

-- ------------------------------------------------------------
-- 4) 날짜별 남은 자리 조회
-- ------------------------------------------------------------
create or replace function public.slot_availability(p_date date)
returns table (slot time, capacity int, booked int)
language sql stable security definer set search_path = public as $$
  select s.slot, slot_cap(p_date, s.slot),
         (select count(*)::int from reservations r
           where r.reserve_date = p_date and r.reserve_time = s.slot) as booked
  from (values (time '09:00'), (time '12:00'), (time '15:00')) as s(slot)
  order by s.slot;
$$;

-- ------------------------------------------------------------
-- 5) 예약 신청 — 검사와 저장을 한 번에 처리
--    (정원·중복·정기 차량·신청 기간을 확인하고, 동시에 여러 명이 신청해도 정원을 넘지 않게 잠금)
--    결과: {"ok": true, "code": "A1B2C3D4", ...} 또는 {"ok": false, "error": "full" 등}
-- ------------------------------------------------------------
create or replace function public.request_reservation(
  p_date date, p_slot time, p_plate text, p_name text, p_phone text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_key    text := upper(regexp_replace(coalesce(p_plate, ''), '[[:space:]·.-]', '', 'g'));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name   text := btrim(coalesce(p_name, ''));
  v_now    timestamp := now() at time zone 'Asia/Seoul';
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
  v_cap    int;
  v_booked int;
  v_id     uuid;
  v_is_reg boolean := false;
begin
  if v_key !~ '^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$' then
    return json_build_object('ok', false, 'error', 'bad_plate');
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    return json_build_object('ok', false, 'error', 'bad_name');
  end if;
  if v_phone !~ '^01[0-9]{8,9}$' then
    return json_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if p_slot is null or p_slot not in ('09:00', '12:00', '15:00') then
    return json_build_object('ok', false, 'error', 'bad_slot');
  end if;
  if p_date is null or p_date < v_today or not apply_date_allowed(p_date) then
    return json_build_object('ok', false, 'error', 'bad_date');      -- 예약 기간·요일이 아님
  end if;
  if p_date = v_today and v_now::time >= p_slot + interval '3 hours' then
    return json_build_object('ok', false, 'error', 'slot_over');      -- 이미 끝난 시간대
  end if;

  -- 정기 차량은 예약 없이 출입 가능 (정기 차량 표가 있을 때만 확인)
  if to_regclass('public.regular_vehicles') is not null then
    execute 'select exists (select 1 from public.regular_vehicles
               where plate_key = $1
                 and (valid_from is null or valid_from <= $2)
                 and (valid_until is null or valid_until >= $2))'
      into v_is_reg using v_key, p_date;
    if v_is_reg then
      return json_build_object('ok', false, 'error', 'regular');
    end if;
  end if;

  -- 같은 날짜·시간대 신청을 한 줄로 세워서 정원 초과를 막음
  perform pg_advisory_xact_lock(hashtext('apply:' || p_date::text || ':' || p_slot::text));

  if exists (select 1 from reservations
              where reserve_date = p_date and reserve_time = p_slot and plate_key = v_key) then
    return json_build_object('ok', false, 'error', 'duplicate');
  end if;

  v_cap := slot_cap(p_date, p_slot);
  select count(*) into v_booked from reservations where reserve_date = p_date and reserve_time = p_slot;
  if coalesce(v_cap, 0) <= v_booked then
    return json_build_object('ok', false, 'error', 'full');
  end if;

  insert into reservations (reserve_date, reserve_time, plate, plate_key)
  values (p_date, p_slot, regexp_replace(v_key, '^(.*[가-힣])([0-9]{4})$', '\1 \2'), v_key)
  returning id into v_id;

  insert into reservation_contacts (reservation_id, name, phone) values (v_id, v_name, v_phone);

  return json_build_object(
    'ok', true,
    'code', upper(substr(replace(v_id::text, '-', ''), 1, 8)),
    'date', p_date, 'slot', to_char(p_slot, 'HH24:MI'),
    'plate', regexp_replace(v_key, '^(.*[가-힣])([0-9]{4})$', '\1 \2'));
end;
$$;

-- ------------------------------------------------------------
-- 6) 내 예약 확인 — 차량번호 + 연락처가 모두 맞는 앞으로의 예약만
-- ------------------------------------------------------------
create or replace function public.my_reservations(p_plate text, p_phone text)
returns table (id uuid, code text, reserve_date date, reserve_time text, plate text)
language sql stable security definer set search_path = public as $$
  select r.id, upper(substr(replace(r.id::text, '-', ''), 1, 8)), r.reserve_date,
         to_char(r.reserve_time, 'HH24:MI'), r.plate
  from reservations r
  join reservation_contacts c on c.reservation_id = r.id
  where r.plate_key = upper(regexp_replace(coalesce(p_plate, ''), '[[:space:]·.-]', '', 'g'))
    and c.phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    and r.reserve_date >= (now() at time zone 'Asia/Seoul')::date
  order by r.reserve_date, r.reserve_time;
$$;

-- ------------------------------------------------------------
-- 7) 예약 취소 — 신청할 때 쓴 연락처가 맞아야 취소됨 (지난 예약은 취소 불가)
-- ------------------------------------------------------------
create or replace function public.cancel_reservation(p_id uuid, p_phone text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  delete from reservations r
   using reservation_contacts c
   where r.id = p_id and c.reservation_id = r.id
     and c.phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
     and r.reserve_date >= (now() at time zone 'Asia/Seoul')::date;
  get diagnostics v_n = row_count;
  return json_build_object('ok', v_n = 1);
end;
$$;

-- ------------------------------------------------------------
-- 8) 웹페이지(anon)에서 쓸 수 있는 함수만 열기
-- ------------------------------------------------------------
revoke all on function public.slot_availability(date) from public;
revoke all on function public.request_reservation(date, time, text, text, text) from public;
revoke all on function public.my_reservations(text, text) from public;
revoke all on function public.cancel_reservation(uuid, text) from public;
grant execute on function public.slot_availability(date) to anon, authenticated;
grant execute on function public.apply_date_allowed(date) to anon, authenticated;
grant execute on function public.request_reservation(date, time, text, text, text) to anon, authenticated;
grant execute on function public.my_reservations(text, text) to anon, authenticated;
grant execute on function public.cancel_reservation(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 9) 개인정보 보관 기간 — 지난 예약의 이름·연락처를 30일 뒤 지움
--    아래 줄을 가끔 직접 실행하거나, Supabase의 Cron(pg_cron)으로 매일 자동 실행하세요. (README 참고)
-- ------------------------------------------------------------
create or replace function public.purge_old_contacts() returns int
language sql security definer set search_path = public as $$
  with d as (
    delete from reservation_contacts c using reservations r
     where c.reservation_id = r.id
       and r.reserve_date < (now() at time zone 'Asia/Seoul')::date - 30
    returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.purge_old_contacts() from public, anon, authenticated;
