-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Negative fixture (D-ARCH-172, PR293-SEC-01 row 4): a cast, whose function runs at x::type without being named.

CREATE CAST (public.fixture_items AS integer) WITH FUNCTION public.fixture_count(public.fixture_items);
