-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_orders (id uuid PRIMARY KEY, org_id uuid NOT NULL);
ALTER TABLE public.fixture_orders ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY p_fixture_orders__tenant ON public.fixture_orders USING (org_id = platform.app_org_id());
CREATE INDEX ix_fixture_orders_org ON public.fixture_orders (org_id);
CREATE TABLE public.fixture_sessions (id uuid PRIMARY KEY, token_hash bytea NOT NULL);
ALTER TABLE public.fixture_sessions ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES public.fixture_orders (id);
GRANT SELECT, INSERT, DELETE ON TABLE public.fixture_sessions TO platform_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.fixture_orders TO platform_app;
