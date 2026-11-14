-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control (SEC-TC-73): a real BEGIN ATOMIC body with CASE … END stays one statement; its END is no transaction control.

CREATE FUNCTION public.fixture_atomic_case(v integer) RETURNS text LANGUAGE sql
BEGIN -- the body
  ATOMIC
  SELECT CASE WHEN v > 0 THEN 'pos' ELSE 'neg' END;
  SELECT (CASE WHEN v > 1 THEN 'big' END);
END;
CREATE SCHEMA fixture_after_atomic;
