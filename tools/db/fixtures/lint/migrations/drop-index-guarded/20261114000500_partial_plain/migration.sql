-- migration-kind: contract
-- data-changing: no
-- reversible: no
-- Negative fixture (F-11): the partial index re-created without WHERE (rule 5 also fires).

SET lock_timeout = '3s';
DROP INDEX public.ix_fixture_items__live;
CREATE INDEX ix_fixture_items__live ON public.fixture_items (owner_id);
