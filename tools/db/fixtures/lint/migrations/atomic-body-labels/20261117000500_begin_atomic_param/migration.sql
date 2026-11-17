-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR #43 R2-n1, the paren gate): a parameter begin of a type atomic opens nothing; the GRANT stays split.

CREATE FUNCTION public.fixture_begin_atomic_param(begin atomic) RETURNS integer LANGUAGE sql RETURN 1;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
END;
