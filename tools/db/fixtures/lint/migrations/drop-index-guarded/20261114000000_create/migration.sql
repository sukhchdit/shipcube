-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Setup: a covering index and a partial index.

CREATE TABLE public.fixture_items (id uuid PRIMARY KEY, owner_id uuid, deleted_at timestamptz);
CREATE INDEX ix_role_permissions__role_id ON public.fixture_items (id) INCLUDE (owner_id);
CREATE INDEX "ix_fixture_items__live" ON public.fixture_items (owner_id) WHERE (deleted_at IS NULL);
