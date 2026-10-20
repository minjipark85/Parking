-- ============================================================
--  실시간 예약확인증 — 방문자 휴대폰의 확인증 페이지(pass.html)가 쓰는 조회 함수
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 하세요. (다시 실행해도 안전)
--  ※ supabase-apply.sql 을 먼저 실행한 DB에서 실행하세요.
--
--  · 정기 차량: 차량번호만으로 확인 (출입 가능 여부와 기간만 알려 주고 메모는 알려 주지 않음)
--  · 예약: 차량번호 + 신청할 때 쓴 연락처가 모두 맞아야 보임
--  · 서버 시각을 함께 돌려줘서, 휴대폰 시계를 바꿔도 색이 바뀌지 않게 함
-- ============================================================

create or replace function public.pass_status(p_plate text, p_phone text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_key   text := upper(regexp_replace(coalesce(p_plate, ''), '[[:space:]·.-]', '', 'g'));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_reg   json;
  v_res   json := '[]'::json;
begin
  if v_key !~ '^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$' then
    return json_build_object('ok', false, 'error', 'bad_plate');
  end if;
  if v_phone <> '' and v_phone !~ '^01[0-9]{8,9}$' then
    return json_build_object('ok', false, 'error', 'bad_phone');
  end if;

  -- 정기 차량 ("서울12가3456"처럼 지역명이 붙은 번호도 찾음, 오늘 유효한 것을 먼저)
  if to_regclass('public.regular_vehicles') is not null then
    execute $q$
      select json_build_object(
               'from', valid_from, 'until', valid_until,
               'active', (valid_from is null or valid_from <= $2) and (valid_until is null or valid_until >= $2))
        from public.regular_vehicles
       where plate_key = $1
          or (length($1) >= 7 and plate_key like '%' || $1)
          or (length(plate_key) >= 7 and $1 like '%' || plate_key)
       order by ((valid_from is null or valid_from <= $2) and (valid_until is null or valid_until >= $2)) desc,
                valid_until desc nulls first
       limit 1 $q$
      into v_reg using v_key, v_today;
  end if;

  -- 예약 (연락처가 맞는 오늘 이후 예약)
  if v_phone <> '' then
    select coalesce(json_agg(json_build_object(
             'code', upper(substr(replace(r.id::text, '-', ''), 1, 8)),
             'date', r.reserve_date,
             'slot', to_char(r.reserve_time, 'HH24:MI'),
             'plate', r.plate) order by r.reserve_date, r.reserve_time), '[]'::json)
      into v_res
      from (select r.* from reservations r
              join reservation_contacts c on c.reservation_id = r.id
             where (r.plate_key = v_key
                    or (length(v_key) >= 7 and r.plate_key like '%' || v_key)
                    or (length(r.plate_key) >= 7 and v_key like '%' || r.plate_key))
               and c.phone = v_phone
               and r.reserve_date >= v_today
             order by r.reserve_date, r.reserve_time
             limit 20) r;
  end if;

  return json_build_object(
    'ok', true,
    'now', now(),
    'today', v_today,
    'plate', regexp_replace(v_key, '^(.*[가-힣])([0-9]{4})$', '\1 \2'),
    'regular', v_reg,
    'reservations', v_res);
end;
$$;

revoke all on function public.pass_status(text, text) from public;
grant execute on function public.pass_status(text, text) to anon, authenticated;
