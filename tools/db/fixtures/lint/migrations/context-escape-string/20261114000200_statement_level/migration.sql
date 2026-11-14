-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-16): a lowercase e-string in a plain statement.

COMMENT ON TABLE public.fixture_items IS e'items\tlist';
