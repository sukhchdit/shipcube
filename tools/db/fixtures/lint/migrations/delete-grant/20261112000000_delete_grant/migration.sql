-- migration-kind: expand
-- data-changing: no
-- reversible: yes

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fixture_items TO platform_app;
