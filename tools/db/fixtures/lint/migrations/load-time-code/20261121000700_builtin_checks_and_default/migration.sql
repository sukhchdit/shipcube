-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control (rule 21): built-in CHECKs, a stable built-in operator, a COALESCE generated column, an identity column and DEFAULT platform.app_org_id() are clean.

CREATE TABLE public.fixture_owners (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL DEFAULT platform.app_org_id(),
  name text NOT NULL CONSTRAINT ck_fixture_owners__name CHECK (pg_catalog.char_length(name) <= 200 AND lower(name) = name),
  at timestamptz NOT NULL CONSTRAINT ck_fixture_owners__at CHECK (at + interval '1 day' > at),
  code text GENERATED ALWAYS AS (COALESCE(name, '')) STORED
);
