-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-14 b): EXECUTE of a variable in a procedure body.

CREATE OR REPLACE PROCEDURE public.fixture_proc(v text) LANGUAGE plpgsql AS $body$
BEGIN
  EXECUTE v;
END
$body$;
