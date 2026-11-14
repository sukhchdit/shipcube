-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): a file that ends inside a BEGIN ATOMIC block is reported (rule L), in both files.

CREATE FUNCTION public.fixture_open() RETURNS integer LANGUAGE sql
BEGIN ATOMIC
  SELECT 1;
CREATE SCHEMA fixture_open;
