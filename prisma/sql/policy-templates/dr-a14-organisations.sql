-- template: dr-a14-organisations (data-model §4.3 "Special policies of DR-A14" as amended 2026-11-13; PR11-SEC-10;
-- D-ARCH-072). Rendered only for the manifest entry organisations (TENANT, policySet dr-a14-organisations); replaces the
-- tenant template: the active organisation, and the organisations the actor belongs to (switcher, GET /me/organisations).
CREATE POLICY p_{{table}}__active ON public.{{table}}
  FOR ALL TO platform_app
  USING      (id = platform.app_org_id())
  WITH CHECK (id = platform.app_org_id());
CREATE POLICY p_{{table}}__member_read ON public.{{table}}
  FOR SELECT TO platform_app
  USING (EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.org_id = {{table}}.id
                    AND m.user_id = platform.app_actor_id()
                    AND m.status IN ('ACTIVE','SUSPENDED')));
