-- ============================================================
--  예약 개설일 관리 — 관리자가 관리자 페이지(admin-7k2q.html)에서 예약을 받을 날짜를 열고 닫습니다.
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (다시 실행해도 안전)
--  ※ supabase-apply.sql, supabase-staff.sql 을 먼저 실행한 DB에서 실행하세요.
-- ============================================================

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

-- 5) 관리자용: 기간 안의 모든 날짜 상태 (열림·공개 예정·예약 건수)
create or replace function public.admin_list_dates(p_from date, p_to date)
returns table (day date, is_open boolean, opens_at timestamptz, booked int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 사용할 수 있어요' using errcode = '42501'; end if;
  return query
    select d::date,
           o.open_date is not null,
           o.opens_at,
           (select count(*)::int from reservations r where r.reserve_date = d::date)
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

revoke all on function public.apply_open_dates() from public;
revoke all on function public.admin_list_dates(date, date) from public;
revoke all on function public.admin_open_dates(date[], timestamptz) from public;
revoke all on function public.admin_close_dates(date[]) from public;
grant execute on function public.apply_open_dates() to anon, authenticated;
grant execute on function public.apply_date_allowed(date) to anon, authenticated;
grant execute on function public.admin_list_dates(date, date) to authenticated;
grant execute on function public.admin_open_dates(date[], timestamptz) to authenticated;
grant execute on function public.admin_close_dates(date[]) to authenticated;

-- 8) 첫 관리자 지정 예시 — 이메일을 바꿔서 실행하거나, Table Editor에서 is_admin 을 체크하세요.
-- update public.staff_emails set is_admin = true where lower(email) = lower('admin@example.com');
