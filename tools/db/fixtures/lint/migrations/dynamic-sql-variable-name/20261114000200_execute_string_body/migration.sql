-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R1-m2): EXECUTE in an AS '…' string body.

CREATE FUNCTION public.fixture_string_body() RETURNS void LANGUAGE plpgsql AS 'BEGIN EXECUTE ''SELECT 1''; END';
