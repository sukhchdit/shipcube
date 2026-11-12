-- template: enable-force (data-model §4.3; every TENANT, GUEST_CAPABLE and USER_OWNED table). FORCE makes the owner
-- platform_migrator subject to RLS as well; no runtime policy targets it.
ALTER TABLE public.{{table}} ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.{{table}} FORCE ROW LEVEL SECURITY;
