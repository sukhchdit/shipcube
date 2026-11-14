-- template: dr-a14-users (data-model §4.3 "Special policies of DR-A14" as amended 2026-11-13; PR11-SEC-10; D-ARCH-072).
-- Rendered only for the manifest entry users (USER_OWNED, policySet dr-a14-users); replaces the user-owned template.
-- The actor's own row, and the rows of members of the active organisation (member lists). The status list is
-- POSITIVE: a future membership_status value stays invisible until it is added here deliberately.
CREATE POLICY p_{{table}}__own ON public.{{table}}
  FOR ALL TO platform_app
  USING      (id = platform.app_actor_id())
  WITH CHECK (id = platform.app_actor_id());
CREATE POLICY p_{{table}}__org_member_read ON public.{{table}}
  FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.user_id = {{table}}.id
                    AND m.org_id = platform.app_org_id()
                    AND m.status IN ('INVITED','ACTIVE','SUSPENDED')));
