-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER ROUTINE platform.fixture_lookup(uuid) SECURITY DEFINER;
