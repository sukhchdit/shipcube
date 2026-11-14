-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: 'abcde', 'a e' and an identifier ending in e before a string are no escape strings.

SELECT 'abcde', 'a e', date'2026-11-14' FROM pg_catalog.pg_type WHERE typname = 'name';
