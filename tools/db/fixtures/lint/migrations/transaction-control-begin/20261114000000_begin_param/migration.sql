-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): a parameter named begin; every later statement is still split and flagged.

CREATE FUNCTION public.fixture_begin_param(begin integer) RETURNS integer LANGUAGE sql RETURN begin;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
CREATE SCHEMA fixture_after_param;
BEGIN;
COMMIT;
