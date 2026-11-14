-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 i): MAINTAIN acts outside RLS.

GRANT SELECT, MAINTAIN ON public.fixture_items TO platform_app;
