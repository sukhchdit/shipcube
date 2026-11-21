-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 a): a domain CHECK that calls a routine of an earlier migration.

CREATE DOMAIN public.fixture_code AS integer CONSTRAINT ck_fixture_code CHECK (public.fixture_check(VALUE));
