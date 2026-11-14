-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 b): query_to_xmlschema in a RETURN body, schema-qualified.

CREATE FUNCTION public.fixture_qs() RETURNS xml LANGUAGE sql RETURN pg_catalog.query_to_xmlschema('SELECT 1', true, false, '');
