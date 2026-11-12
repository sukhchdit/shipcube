-- migration-kind: expand
-- data-changing: no
-- reversible: yes
ALTER TABLE public.audit_entries DISABLE TRIGGER ALL;
