-- template: operator (data-model §4.3; ADR-0005 amendment 2). Cross-tenant READ for verified operators only; the
-- membership check runs in platform.app_is_operator() (SECURITY DEFINER, owner platform_definer).
CREATE POLICY p_{{table}}__operator ON public.{{table}}
  FOR SELECT TO platform_app
  USING (current_setting('app.actor_scope', true) = 'OPERATOR' AND platform.app_is_operator());
