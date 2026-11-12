-- migration-kind: expand
-- data-changing: no
-- reversible: yes
SET lock_timeout = '2s';
ALTER TABLE public.audit_entries DISABLE TRIGGER ALL;
