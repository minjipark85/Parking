-- ============================================================
--  보안 점검 — SQL Editor 에 붙여넣고 Run 하면 결과 표가 나옵니다. (아무것도 바꾸지 않고 확인만 함)
--  "판정" 칸이 모두 '정상'이면 됩니다. '확인 필요'가 있으면 그 줄의 '설명'을 보고 조치하세요.
-- ============================================================
with t as (
  select c.relname as tbl, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
), pol as (
  select tablename as tbl, policyname, roles, cmd, qual
    from pg_policies where schemaname = 'public'
), fn as (
  select p.proname as fname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
)
-- 1) 모든 표에 행 단위 보안(RLS)이 켜져 있는지
select '1. 표 잠금(RLS)' as 항목, tbl as 대상,
       case when rls then '정상' else '확인 필요' end as 판정,
       case when rls then '켜짐' else 'RLS가 꺼져 있어 누구나 읽고 쓸 수 있음 → Table Editor에서 RLS 켜기' end as 설명
  from t
union all
-- 2) 누구나(로그인 안 한 사람) 읽을 수 있는 정책 — 정원 표(slot_capacity)만 괜찮음
select '2. 누구나 읽기 정책', tbl || ' / ' || policyname,
       case when tbl = 'slot_capacity' then '정상' else '확인 필요' end,
       case when tbl = 'slot_capacity' then '시간대 기본 정원 숫자만 공개 (개인정보 없음)'
            else '로그인 없이 읽을 수 있음 → supabase-staff.sql 다시 실행' end
  from pol
 where ('public' = any(roles) or 'anon' = any(roles)) and cmd in ('SELECT', 'ALL')
union all
-- 3) 쓰기(추가·수정·삭제) 정책 — 웹에서 직접 쓰는 정책은 없어야 함 (신청은 검사 함수로만)
select '3. 직접 쓰기 정책', tbl || ' / ' || policyname, '확인 필요', '웹에서 표에 직접 쓸 수 있음 → 이 정책 삭제'
  from pol where cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
union all
-- 4) 로그인 없이 실행할 수 있는 함수 — 아래 목록에 있는 것만 정상
select '4. 공개 함수', fname,
       case when fname in ('slot_availability', 'request_reservation', 'my_reservations', 'cancel_reservation',
                           'apply_date_allowed', 'apply_open_dates', 'apply_upcoming_dates', 'pass_status',
                           'is_staff', 'is_admin') then '정상' else '확인 필요' end,
       case when fname in ('slot_availability', 'request_reservation', 'my_reservations', 'cancel_reservation',
                           'apply_date_allowed', 'apply_open_dates', 'apply_upcoming_dates', 'pass_status',
                           'is_staff', 'is_admin') then '신청·조회용 (입력 검사 후 필요한 것만 돌려줌)'
            else '로그인 없이 실행 가능 → 의도한 것이 아니면 revoke' end
  from fn
union all
-- 5) 관리자 함수는 관리자만
select '5. 관리자 지정', coalesce(string_agg(email, ', '), '(없음)'),
       case when count(*) between 1 and 5 then '정상' else '확인 필요' end,
       '관리자(is_admin) 계정 ' || count(*) || '개 — 꼭 필요한 사람만'
  from public.staff_emails where is_admin
order by 1, 2;
