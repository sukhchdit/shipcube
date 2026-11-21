-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (D-ARCH-172, PR293-SEC-01 row 5): an aggregate, whose SFUNC runs at a(...) without being named.

CREATE OR REPLACE AGGREGATE public.fixture_total(integer) (SFUNC = int4pl, STYPE = integer);
