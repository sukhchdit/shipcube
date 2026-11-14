-- migration-kind: contract
-- data-changing: no
-- reversible: no
-- Control (F-11): re-created with the same WHERE (rule 5 still fires).

SET lock_timeout = '3s';
DROP INDEX public.ix_fixture_items__live;
CREATE INDEX ix_fixture_items__live ON public.fixture_items (owner_id) WHERE deleted_at IS NULL;
