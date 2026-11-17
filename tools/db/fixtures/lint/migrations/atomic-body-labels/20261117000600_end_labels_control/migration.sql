-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control (PR43-SEC-11): labels AS end and a bare end are part of their body statement; the routine stays one statement.

CREATE FUNCTION public.fixture_end_labels() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1 AS end;
  SELECT CASE WHEN random() > 2 THEN 1 ELSE 2 END end;
END;
CREATE SCHEMA fixture_after_end_labels;
