-- migration-kind: expand
-- data-changing: no
-- reversible: yes
UPDATE public.fixture_items SET note = 'x';
DELETE FROM public.fixture_items WHERE note IS NULL;
