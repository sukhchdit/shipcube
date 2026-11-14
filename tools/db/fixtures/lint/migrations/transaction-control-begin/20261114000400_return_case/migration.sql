-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): RETURN CASE … END at depth 0 opens no block.

CREATE FUNCTION public.fixture_case(v integer) RETURNS text LANGUAGE sql RETURN CASE WHEN v > 0 THEN 'pos' ELSE 'neg' END;
CREATE SCHEMA fixture_after_case;
