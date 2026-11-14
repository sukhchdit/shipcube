-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR24-SEC-02): an operator.

CREATE OPERATOR public.=== (LEFTARG = int4, RIGHTARG = int4, FUNCTION = int4eq);
