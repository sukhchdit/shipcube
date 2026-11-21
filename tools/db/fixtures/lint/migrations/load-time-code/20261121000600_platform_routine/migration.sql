-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (rule 21 b): a CHECK that calls platform.<routine>, which no migration of this fixture creates (a bootstrap or extension routine).

CREATE TABLE public.fixture_items (id integer CONSTRAINT ck_fixture_items__platform CHECK (platform.fixture_unknown(id)));
