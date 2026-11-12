-- migration-kind: expand
-- data-changing: no
-- reversible: yes
WITH stale AS (SELECT id FROM public.fixture_items) UPDATE public.fixture_items SET note = 'x' WHERE id IN (SELECT id FROM stale);
