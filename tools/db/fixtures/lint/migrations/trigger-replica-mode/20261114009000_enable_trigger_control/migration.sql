-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: a plain ENABLE TRIGGER.

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ENABLE TRIGGER trg_fixture_items;
