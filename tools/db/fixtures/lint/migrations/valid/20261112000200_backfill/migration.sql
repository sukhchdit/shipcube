-- migration-kind: migrate
-- data-changing: yes
-- reversible: yes
UPDATE public.fixture_items SET note = 'n/a' WHERE note IS NULL;
