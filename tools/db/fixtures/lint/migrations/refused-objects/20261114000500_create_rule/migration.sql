-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-15 e): a rewrite rule.

CREATE OR REPLACE RULE fixture_rule AS ON INSERT TO public.fixture_items DO INSTEAD NOTHING;
