-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11): a bare column label case inside the body; the SET lock_timeout and the END stay split.

CREATE FUNCTION public.fixture_bare_case() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1 case;
END;
SET lock_timeout = '10s';
END;
