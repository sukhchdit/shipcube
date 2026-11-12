-- migration-kind: expand
-- data-changing: no
-- reversible: yes
SET lock_timeout = '2s';
ALTER TABLE public.audit_entries DETACH PARTITION public.audit_entries_2026_11;
