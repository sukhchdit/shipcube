-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER FUNCTION platform.fixture_lookup(uuid) SET search_path = pg_catalog, pg_temp SET search_path = public;
