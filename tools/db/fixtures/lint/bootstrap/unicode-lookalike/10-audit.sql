-- no Unicode escape: the bitwise & operator and an identifier ending in u (control)
SET search_path = pg_catalog, pg_temp;
SELECT 6 & 3 AS bits, 'menu&"label"' AS note, U & 1 AS spaced FROM (SELECT 1 AS u) AS t;
