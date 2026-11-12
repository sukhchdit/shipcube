-- migration-kind: expand
-- data-changing: no
-- reversible: yes
WITH locked AS (SELECT id, 'update' AS last_update FROM public.fixture_items FOR UPDATE) SELECT * FROM locked;
WITH k AS (SELECT id FROM public.fixture_items FOR NO KEY UPDATE OF fixture_items) SELECT 'delete from x' FROM k;
