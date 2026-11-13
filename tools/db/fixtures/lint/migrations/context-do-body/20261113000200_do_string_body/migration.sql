-- migration-kind: expand
-- data-changing: no
-- reversible: yes

DO 'BEGIN PERFORM set_config(''app.actor_id'', ''x'', true); END';
