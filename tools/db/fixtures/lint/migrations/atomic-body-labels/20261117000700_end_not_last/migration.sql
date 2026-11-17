-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11, rule L): text after the END of a routine body (END WORK) is no split, it is a finding.

CREATE FUNCTION public.fixture_end_work() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1;
END WORK;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
END;
