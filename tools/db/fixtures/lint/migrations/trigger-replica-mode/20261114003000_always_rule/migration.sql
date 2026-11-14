-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-05 a): ENABLE ALWAYS RULE.

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ENABLE ALWAYS RULE r_fixture_items;
