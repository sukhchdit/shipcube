-- template: user-owned (data-model §4.3 USER_OWNED). The actor's own rows only.
CREATE POLICY p_{{table}}__own ON public.{{table}}
  FOR ALL TO platform_app
  USING      (user_id = platform.app_actor_id())
  WITH CHECK (user_id = platform.app_actor_id());
