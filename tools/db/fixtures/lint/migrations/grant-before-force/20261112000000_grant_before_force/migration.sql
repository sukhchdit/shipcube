-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);
GRANT SELECT ON public.fixture_orders TO platform_app;
ALTER TABLE public.fixture_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_orders FORCE ROW LEVEL SECURITY;
