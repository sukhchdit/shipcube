-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 b): query_to_xml_and_xmlschema in a BEGIN ATOMIC body.

CREATE PROCEDURE public.fixture_qa() LANGUAGE sql
BEGIN ATOMIC
  SELECT query_to_xml_and_xmlschema('SELECT 1', true, false, '');
END;
