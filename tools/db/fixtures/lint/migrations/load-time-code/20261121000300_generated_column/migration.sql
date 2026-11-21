-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 a): a STORED generated column that calls a routine of an earlier migration.

CREATE TABLE public.fixture_owners (id integer PRIMARY KEY, flag boolean GENERATED ALWAYS AS (public.fixture_check(id)) STORED);
