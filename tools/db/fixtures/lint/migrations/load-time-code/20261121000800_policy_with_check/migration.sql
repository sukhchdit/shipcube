-- migration-kind: expand
-- data-changing: no
-- reversible: yes
-- Control (rule 21): a policy WITH CHECK is no load-time clause (a privileged role bypasses row security); rule 9 still refuses a policy the renderer does not emit.

SET lock_timeout = '3s';
CREATE POLICY fixture_items_insert ON public.fixture_items FOR INSERT TO platform_app WITH CHECK (org_id = platform.app_org_id());
