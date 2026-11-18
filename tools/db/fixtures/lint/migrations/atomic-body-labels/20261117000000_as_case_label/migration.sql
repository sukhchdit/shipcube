-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11): a label AS case inside the body; the GRANT and the END after the routine stay split.

CREATE FUNCTION public.fixture_as_case() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1 AS case;
END;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
END;
