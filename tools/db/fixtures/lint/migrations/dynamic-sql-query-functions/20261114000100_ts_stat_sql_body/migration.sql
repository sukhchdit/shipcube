-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 b): ts_stat in a SQL dollar body.

CREATE FUNCTION public.fixture_ts() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM ts_stat('SELECT to_tsvector(''x'')') $$;
