-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 a): a routine SET clause.

CREATE FUNCTION public.fixture_scs() RETURNS integer LANGUAGE sql SET standard_conforming_strings = off AS $$ SELECT 1 $$;
