-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR11-SEC-11 e): a table in the platform schema.

CREATE TABLE platform.fixture_items (id uuid PRIMARY KEY);
