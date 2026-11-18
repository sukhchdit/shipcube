-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11): SELECT begin atomic (a column and a bare label) inside the body opens nothing.

CREATE FUNCTION public.fixture_begin_atomic_alias() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT begin atomic FROM (VALUES (1)) AS v(begin);
END;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
END;
