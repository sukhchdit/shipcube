-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
DROP POLICY p_fixture_orders__tenant ON public.fixture_orders;
