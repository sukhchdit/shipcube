-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
CREATE INDEX ix_fixture_items_note ON public.fixture_items (note);
