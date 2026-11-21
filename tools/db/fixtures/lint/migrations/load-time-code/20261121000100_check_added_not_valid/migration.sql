-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 a): the security record's probe P1b, clean under every rule before: an unqualified call of an earlier routine, added NOT VALID and validated.

SET lock_timeout = '3s';
ALTER TABLE public.fixture_items ADD CONSTRAINT ck_fixture_items__probe CHECK (fixture_check(id)) NOT VALID;
ALTER TABLE public.fixture_items VALIDATE CONSTRAINT ck_fixture_items__probe;
