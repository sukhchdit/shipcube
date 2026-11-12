-- migration-kind: expand
-- data-changing: no
-- reversible: yes

GRANT SELECT, TRUNCATE ON public.fixture_items TO platform_app;
