-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
DROP POLICY p_fixture_orders__tenant ON public.fixture_orders;
CREATE POLICY p_fixture_orders__tenant ON public.fixture_orders FOR ALL TO platform_app USING (org_id = platform.app_org_id()) WITH CHECK (org_id = platform.app_org_id());
ALTER TABLE public.fixture_orders ADD CONSTRAINT fk_orders_org FOREIGN KEY (org_id) REFERENCES public.fixture_items (id) NOT VALID;
ALTER TABLE public.fixture_orders VALIDATE CONSTRAINT fk_orders_org;
