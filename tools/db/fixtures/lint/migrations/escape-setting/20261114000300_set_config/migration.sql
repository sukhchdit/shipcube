-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 a): set_config.

SELECT set_config('standard_conforming_strings', 'off', false);
