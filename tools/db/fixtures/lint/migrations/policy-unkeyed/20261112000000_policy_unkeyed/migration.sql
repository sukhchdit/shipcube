-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_quotes (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea);
ALTER TABLE public.fixture_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixture_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY p_fixture_quotes__guest ON public.fixture_quotes FOR SELECT TO platform_app USING (org_id IS NULL);
