-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): a function named begin (migration.sql and down.sql).

CREATE FUNCTION public.begin() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SET lock_timeout = '10s';
