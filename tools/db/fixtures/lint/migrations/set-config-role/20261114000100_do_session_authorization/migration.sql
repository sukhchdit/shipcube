-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 b): session_authorization in a DO body, any case.

DO $$
BEGIN
  PERFORM set_config('SESSION_AUTHORIZATION', 'platform_definer', false);
END
$$;
