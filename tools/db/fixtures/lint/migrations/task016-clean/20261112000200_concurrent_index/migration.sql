-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE INDEX CONCURRENTLY ix_fixture_items_note ON public.fixture_items (note);
