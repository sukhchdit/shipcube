-- template: definer-purge (data-model §4.3; token tables only, together with definer-read, because DELETE ... WHERE
-- also applies the SELECT policy). Used by platform.purge_expired_tokens (§4.5).
CREATE POLICY p_{{table}}__definer_purge ON public.{{table}}
  FOR DELETE TO platform_definer
  USING (expires_at < now() - interval '7 days');
GRANT DELETE ON public.{{table}} TO platform_definer;
