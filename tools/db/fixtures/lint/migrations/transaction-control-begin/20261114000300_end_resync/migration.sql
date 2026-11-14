-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (PR43-SEC-03): a later END; must not resync a block that never opened and hide the GRANT.

CREATE PROCEDURE public.fixture_begin_proc(begin integer) LANGUAGE sql AS $$ SELECT 1 $$;
GRANT TRUNCATE ON public.fixture_items TO platform_app;
END;
CREATE SCHEMA fixture_after_resync;
