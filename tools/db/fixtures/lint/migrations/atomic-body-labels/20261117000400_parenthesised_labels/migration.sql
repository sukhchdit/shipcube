-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R2-n1): a parenthesised AS case and t.end inside the body; the DROP TABLE and the END stay split.

CREATE FUNCTION public.fixture_paren_labels() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT xmlelement(name x, xmlattributes(1 AS case));
  SELECT abs(t.end) FROM (VALUES (1)) AS t("end");
END;
DROP TABLE public.fixture_items;
END;
