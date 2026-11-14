SET search_path = pg_catalog, pg_temp;
-- Negative fixture (PR43-SEC-06 a): plain strings with live backslash escapes in the bootstrap lane.
SET standard_conforming_strings = off;
SELECT 'audit\x5fentries';
