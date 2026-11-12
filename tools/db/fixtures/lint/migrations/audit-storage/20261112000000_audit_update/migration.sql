-- migration-kind: migrate
-- data-changing: yes
-- reversible: no

UPDATE public.audit_entries SET payload = '{}';
