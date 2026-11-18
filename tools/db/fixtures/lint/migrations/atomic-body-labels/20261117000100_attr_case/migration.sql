-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-11): an attribute t.case inside the body; the DROP TABLE and the END stay split.

CREATE FUNCTION public.fixture_attr_case() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT t.case FROM (VALUES (1)) AS t("case");
END;
DROP TABLE public.fixture_items;
END;
