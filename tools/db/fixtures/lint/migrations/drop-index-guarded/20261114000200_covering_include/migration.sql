-- migration-kind: contract
-- data-changing: no
-- reversible: no
-- Control (F-04): re-created WITH INCLUDE (rule 5 still fires).

SET lock_timeout = '3s';
DROP INDEX ix_role_permissions__role_id;
CREATE INDEX ix_role_permissions__role_id ON public.fixture_items (id) INCLUDE (owner_id);
