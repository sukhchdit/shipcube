-- migration-kind: expand
-- data-changing: no
-- reversible: yes

GRANT REFERENCES (id) ON public.fixture_items TO platform_app;
