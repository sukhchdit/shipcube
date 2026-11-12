-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
ALTER POLICY p_fixture_orders__tenant ON public.fixture_orders USING (true);
