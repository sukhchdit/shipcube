-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE FUNCTION public.fixture_touch() RETURNS void LANGUAGE sql AS $$ UPDATE public.fixture_items SET note = note $$;
