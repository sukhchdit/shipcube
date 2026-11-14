-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR24-SEC-02): an operator class.

CREATE OPERATOR CLASS public.fixture_ops FOR TYPE int4 USING btree AS OPERATOR 1 <;
