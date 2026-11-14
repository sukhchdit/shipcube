-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control: EXECUTE FUNCTION, GRANT EXECUTE, the word in a message and a DO body.

CREATE FUNCTION public.fixture_noop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'execute later';
  RETURN NEW;
END
$$;
CREATE TABLE public.fixture_events (id uuid PRIMARY KEY);
CREATE TRIGGER fixture_trg BEFORE INSERT ON public.fixture_events FOR EACH ROW EXECUTE FUNCTION public.fixture_noop();
REVOKE EXECUTE ON FUNCTION public.fixture_noop() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fixture_noop() TO platform_app;
DO $$
BEGIN
  EXECUTE 'SELECT 1';
END
$$;
