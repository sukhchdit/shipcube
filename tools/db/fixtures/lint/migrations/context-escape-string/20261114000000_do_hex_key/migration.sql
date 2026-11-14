-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-16): an E-string spells the org key in hex inside a DO body.

DO $$
BEGIN
  EXECUTE E'SELECT set_config(\x27\x61pp.org_id\x27, \x27x\x27, true)';
END
$$;
