-- migration-kind: expand
-- data-changing: no
-- reversible: yes
WITH stale AS (SELECT id FROM public.fixture_items) DELETE FROM public.fixture_items WHERE id IN (SELECT id FROM stale);
