-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (D-ARCH-237, PR034-SEC-05): a range type names its subtype_diff routine without a call.

CREATE TYPE public.fixture_span AS RANGE (subtype = integer);
SELECT 1;
