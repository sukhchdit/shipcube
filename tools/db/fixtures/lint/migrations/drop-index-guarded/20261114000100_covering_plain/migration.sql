-- migration-kind: contract
-- data-changing: no
-- reversible: no
-- Negative fixture (F-04): the covering index re-created without INCLUDE (rule 5 also fires).

SET lock_timeout = '3s';
DROP INDEX public.ix_role_permissions__role_id;
CREATE INDEX ix_role_permissions__role_id ON public.fixture_items (id);
