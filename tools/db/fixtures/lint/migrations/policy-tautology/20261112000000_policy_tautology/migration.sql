-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);
ALTER TABLE public.fixture_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY p_fixture_orders__tenant ON public.fixture_orders FOR ALL TO platform_app USING (org_id = org_id) WITH CHECK (org_id = org_id);
