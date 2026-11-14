-- template: dr-a14-memberships (data-model §4.3 "Special policies of DR-A14" as amended 2026-11-13; PR11-SEC-10;
-- D-ARCH-072). Rendered only for the manifest entry memberships (TENANT, policySet dr-a14-memberships), AFTER the tenant
-- template: the actor's own memberships in any organisation (organisation switcher). No subquery: a memberships policy
-- that read another RLS table would recurse (42P17).
CREATE POLICY p_{{table}}__own_read ON public.{{table}}
  FOR SELECT TO platform_app
  USING (user_id = platform.app_actor_id());
