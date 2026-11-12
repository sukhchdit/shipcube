-- migration-kind: expand
-- data-changing: no
-- reversible: yes

CREATE TABLE public.fixture_events (id uuid NOT NULL, at date NOT NULL) PARTITION BY RANGE (at);
CREATE TABLE public.fixture_events_2026 PARTITION OF public.fixture_events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
GRANT SELECT ON public.fixture_events_2026 TO platform_app;
