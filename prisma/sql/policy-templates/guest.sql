-- template: guest (data-model §4.3 GUEST_CAPABLE: quotes, quote_packages, quote_options, quote_shares).
CREATE POLICY p_{{table}}__guest ON public.{{table}}
  FOR ALL TO platform_app
  USING      (org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash())
  WITH CHECK (org_id IS NULL AND guest_token_hash = platform.app_guest_token_hash());
