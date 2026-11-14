-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 a): ALTER FUNCTION … SET.

ALTER FUNCTION public.fixture_scs() SET backslash_quote = on;
