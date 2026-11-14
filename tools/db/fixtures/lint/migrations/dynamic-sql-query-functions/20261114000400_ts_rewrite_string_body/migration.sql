-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-06 b): ts_rewrite in an AS '…' string body.

CREATE FUNCTION public.fixture_tr() RETURNS tsquery LANGUAGE sql AS 'SELECT ts_rewrite(''a''::tsquery, ''SELECT t, s FROM public.fixture_items'')';
