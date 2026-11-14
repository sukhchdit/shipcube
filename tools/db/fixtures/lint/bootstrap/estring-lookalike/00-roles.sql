SET search_path = pg_catalog, pg_temp;
-- Control: 'abcde', 'a e' and date'…' hold no escape string.
SELECT 'abcde', 'a e', date'2026-11-14';
