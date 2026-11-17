-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11, rule L): a body semicolon inside parentheses is a finding, never a resync.

CREATE FUNCTION public.fixture_paren_semicolon() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT (1;
END;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
SELECT 1);
END;
