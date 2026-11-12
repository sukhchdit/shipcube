-- migration-kind: expand
-- data-changing: no
-- reversible: yes

ALTER ROUTINE platform.fixture_plain() OWNER TO "platform_definer";
