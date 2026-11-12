-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ADD CONSTRAINT fk_items_owner FOREIGN KEY (owner_id) REFERENCES public.fixture_owners (id);
