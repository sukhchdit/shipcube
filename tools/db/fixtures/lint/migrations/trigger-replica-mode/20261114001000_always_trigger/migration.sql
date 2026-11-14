-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-05 a): ENABLE ALWAYS TRIGGER.

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ENABLE ALWAYS TRIGGER trg_fixture_items;
