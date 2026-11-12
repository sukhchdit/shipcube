-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER ROUTINE platform.fixture_lookup(uuid) SET search_path = public;
