-- ============================================================
--  예약 개설일 관리 — 관리자가 관리자 페이지(admin-7k2q.html)에서 예약을 받을 날짜를 열고 닫습니다.
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (다시 실행해도 안전)
--  ※ supabase-apply.sql, supabase-staff.sql 을 먼저 실행한 DB에서 실행하세요.
--    (날짜별 정원 기능이 추가되어, 예전에 실행했더라도 supabase-apply.sql 을 한 번 더 실행한 뒤 이 파일을 실행)
-- ============================================================

do $$ begin
  if to_regprocedure('public.slot_cap(date, time)') is null then
    raise exception '먼저 supabase-apply.sql 을 (다시) 실행한 뒤 이 파일을 실행해 주세요.';
  end if;
end $$;

-- 1) 관리자 지정 — staff_emails 에 is_admin 칸 추가 (Table Editor에서 체크하면 관리자)
alter table public.staff_emails add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_emails
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and is_admin
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) 예약 개설일 — 이 표에 있는 날짜만 신청 페이지에 나옵니다.
--    opens_at 을 비우면 바로 공개, 일시를 넣으면 그때부터 공개 (기간별로 나눠 오픈할 때)
create table if not exists public.open_dates (
  open_date  date primary key,
  opens_at   timestamptz,
  created_at timestamptz not null default now()
);
alter table public.open_dates enable row level security;      -- 정책 없음 = 아래 함수로만 읽고 바꿈
revoke all on public.open_dates from anon, authenticated;

-- 지금까지 쓰던 날짜(2026-10-24 ~ 11-22 토·일)를 그대로 옮겨 둠 (이미 있으면 건너뜀)
insert into public.open_dates (open_date)
select d::date from generate_series(date '2026-10-24', date '2026-11-22', interval '1 day') d
 where extract(isodow from d) in (6, 7)
on conflict (open_date) do nothing;

-- 3) 신청 가능 여부 — 개설일 표 기준 (공개 일시가 지났거나 비어 있어야 함)
create or replace function public.apply_date_allowed(p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from open_dates
                  where open_date = p_date and (opens_at is null or opens_at <= now()));
$$;

-- 4) 신청 페이지용: 지금 신청할 수 있는 날짜 목록 (오늘 이후, 공개된 것만)
create or replace function public.apply_open_dates()
returns table (open_date date)
language sql stable security definer set search_path = public as $$
  select o.open_date from open_dates o
   where o.open_date >= (now() at time zone 'Asia/Seoul')::date
     and (o.opens_at is null or o.opens_at <= now())
   order by o.open_date;
$$;

-- 4-1) 신청 페이지용: 공개 예정인 날짜와 공개 시각 (흐리게 "10/21(수) 14시 오픈"으로 보여 줌)
create or replace function public.apply_upcoming_dates()
returns table (open_date date, opens_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.open_date, o.opens_at from open_dates o
   where o.open_date >= (now() at time zone 'Asia/Seoul')::date
     and o.opens_at > now()
   order by o.open_date;
$$;

-- 5) 관리자용: 기간 안의 모든 날짜 상태 (열림·공개 예정·예약 건수·시간대별 정원)
drop function if exists public.admin_list_dates(date, date);   -- 결과 칸이 늘어서 새로 만듦
create function public.admin_list_dates(p_from date, p_to date)
returns table (day date, is_open boolean, opens_at timestamptz, booked int,
               cap_09 int, cap_12 int, cap_15 int, bk_09 int, bk_12 int, bk_15 int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있어요' using errcode = '42501'; end if;
  return query
    select d::date,
           o.open_date is not null,
           o.opens_at,
           (select count(*)::int from reservations r where r.reserve_date = d::date),
           slot_cap(d::date, '09:00'), slot_cap(d::date, '12:00'), slot_cap(d::date, '15:00'),
           (select count(*)::int from reservations r where r.reserve_date = d::date and r.reserve_time = '09:00'),
           (select count(*)::int from reservations r where r.reserve_date = d::date and r.reserve_time = '12:00'),
           (select count(*)::int from reservations r where r.reserve_date = d::date and r.reserve_time = '15:00')
      from generate_series(p_from, p_to, interval '1 day') d
      left join open_dates o on o.open_date = d::date
     order by 1;
end;
$$;

-- 6) 관리자용: 날짜 열기 (p_opens_at 이 null 이면 바로 공개) — 이미 열린 날은 공개 일시만 바뀜
create or replace function public.admin_open_dates(p_dates date[], p_opens_at timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있어요' using errcode = '42501'; end if;
  insert into open_dates (open_date, opens_at)
  select distinct d, p_opens_at from unnest(p_dates) d where d is not null
  on conflict (open_date) do update set opens_at = excluded.opens_at;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 7) 관리자용: 날짜 닫기 — 신청 페이지에서 사라짐. 이미 받은 예약은 그대로 유지
create or replace function public.admin_close_dates(p_dates date[])
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있어요' using errcode = '42501'; end if;
  delete from open_dates where open_date = any (p_dates);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 7-1) 관리자용: 날짜별·시간대별 정원 저장 (null 인 시간대는 그대로 둠)
--      정원을 이미 받은 예약보다 적게 해도 기존 예약은 유지되고, 추가 신청만 막힙니다.
create or replace function public.admin_set_caps(p_dates date[], p_c09 int, p_c12 int, p_c15 int)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있어요' using errcode = '42501'; end if;
  if least(coalesce(p_c09, 0), coalesce(p_c12, 0), coalesce(p_c15, 0)) < 0
     or greatest(coalesce(p_c09, 0), coalesce(p_c12, 0), coalesce(p_c15, 0)) > 100000 then
    raise exception '정원은 0 ~ 100000 사이로 넣어 주세요' using errcode = '22023';
  end if;
  insert into date_slot_capacity (open_date, slot, capacity)
  select distinct d, s.slot, s.cap
    from unnest(p_dates) d
   cross join (values (time '09:00', p_c09), (time '12:00', p_c12), (time '15:00', p_c15)) as s(slot, cap)
   where d is not null and s.cap is not null
  on conflict (open_date, slot) do update set capacity = excluded.capacity;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.apply_open_dates() from public;
revoke all on function public.admin_list_dates(date, date) from public;
revoke all on function public.admin_open_dates(date[], timestamptz) from public;
revoke all on function public.admin_close_dates(date[]) from public;
grant execute on function public.apply_open_dates() to anon, authenticated;
revoke all on function public.apply_upcoming_dates() from public;
grant execute on function public.apply_upcoming_dates() to anon, authenticated;
grant execute on function public.apply_date_allowed(date) to anon, authenticated;
grant execute on function public.admin_list_dates(date, date) to authenticated;
grant execute on function public.admin_open_dates(date[], timestamptz) to authenticated;
grant execute on function public.admin_close_dates(date[]) to authenticated;
revoke all on function public.admin_set_caps(date[], int, int, int) from public;
grant execute on function public.admin_set_caps(date[], int, int, int) to authenticated;

-- 8) 첫 관리자 지정 예시 — 이메일을 바꿔서 실행하거나, Table Editor에서 is_admin 을 체크하세요.
-- update public.staff_emails set is_admin = true where lower(email) = lower('admin@example.com');
