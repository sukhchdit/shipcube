-- template: definer-read (data-model §4.3; SEC-P3-25). Only for tables a §4.5 function reads; SELECT only.
CREATE POLICY p_{{table}}__definer_read ON public.{{table}}
  FOR SELECT TO platform_definer
  USING (true);
GRANT SELECT ON public.{{table}} TO platform_definer;
