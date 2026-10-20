-- ============================================================
--  보안 점검(supabase-security-check.sql)에서 '확인 필요'로 나온
--  관리자 함수·내부 함수의 "로그인 없이 실행" 권한을 회수합니다. 한 번만 실행하면 됩니다. (다시 실행해도 안전)
-- ============================================================
revoke execute on function public.admin_list_dates(date, date) from anon;
revoke execute on function public.admin_open_dates(date[], timestamptz) from anon;
revoke execute on function public.admin_close_dates(date[]) from anon;
revoke execute on function public.admin_set_caps(date[], int, int, int) from anon;
revoke all on function public.slot_cap(date, time) from public, anon, authenticated;
-- 내부 함수: 개인정보 삭제 함수도 웹에서는 실행 못 하게 (예약 함수들이 안에서만 씀)
revoke all on function public.purge_old_contacts() from public, anon, authenticated;
