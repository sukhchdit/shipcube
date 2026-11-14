-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 a): SET in dynamic SQL of a DO body.

DO $$
BEGIN
  EXECUTE 'SET standard_conforming_strings = off';
END
$$;
