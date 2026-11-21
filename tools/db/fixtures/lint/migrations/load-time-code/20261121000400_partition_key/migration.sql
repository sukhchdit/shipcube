-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 a): a partition-key expression that calls a routine of an earlier migration.

CREATE TABLE public.fixture_events (id integer NOT NULL) PARTITION BY LIST ((public.fixture_check(id)));
