-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 c): a CHECK that runs a query string through a built-in.

CREATE TABLE public.fixture_items (id integer CONSTRAINT ck_fixture_items__xml CHECK (pg_catalog.query_to_xml('select 1', true, false, '') IS NOT NULL));
