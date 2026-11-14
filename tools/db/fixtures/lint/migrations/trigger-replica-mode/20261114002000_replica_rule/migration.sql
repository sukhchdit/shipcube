-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-05 a): ENABLE REPLICA RULE.

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ENABLE REPLICA RULE r_fixture_items;
