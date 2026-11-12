-- migration-kind: expand
-- data-changing: no
-- reversible: yes

SET lock_timeout = '2s';
ALTER TABLE public.fixture_items ADD COLUMN qty int NOT NULL DEFAULT 0, ADD COLUMN state text NOT NULL DEFAULT 'new'::text;
ALTER TABLE public.fixture_items ADD CONSTRAINT chk_note_nn CHECK (note IS NOT NULL) NOT VALID;
CREATE TABLE public.fixture_sessions (id uuid PRIMARY KEY, token text NOT NULL);
ALTER TABLE public.fixture_sessions ADD COLUMN expires_at timestamptz NOT NULL;
