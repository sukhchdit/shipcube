-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);
ALTER TABLE public.fixture_orders ENABLE ROW LEVEL SECURITY;
