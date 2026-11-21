-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 a, PR034-SEC-01): a table CHECK that calls a routine of this migration.

CREATE FUNCTION public.fixture_check(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE TABLE public.fixture_items (id integer PRIMARY KEY CONSTRAINT ck_fixture_items__id CHECK (public.fixture_check(id)));
