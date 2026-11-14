-- template: std-columns-guard-trigger (data-model §7.6 amendment of 2026-11-13; D-ARCH-091; catalog C15). Rendered for
-- every manifest table flagged stdColumns (full STD set, runtime-writable, not an audit table); never hand-written.
CREATE TRIGGER trg_{{table}}__std_columns BEFORE INSERT OR UPDATE ON public.{{table}}
  FOR EACH ROW EXECUTE FUNCTION platform.std_columns_guard();
