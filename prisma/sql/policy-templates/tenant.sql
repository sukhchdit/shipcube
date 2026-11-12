-- template: tenant (data-model §4.3 TENANT; REQ-RLS-001). Reads and writes of the active organisation only.
CREATE POLICY p_{{table}}__tenant ON public.{{table}}
  FOR ALL TO platform_app
  USING      (org_id = platform.app_org_id())
  WITH CHECK (org_id = platform.app_org_id());
