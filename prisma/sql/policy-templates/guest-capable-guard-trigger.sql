-- template: guest-capable-guard-trigger (data-model §4.3 amendment; ADR-0005 am. 10 item 11; PR7-SEC-04,
-- PR7-SEC-12 (d)). Every GUEST_CAPABLE table; the function is rendered once by renderGuestCapableGuardFunction().
CREATE TRIGGER tg_{{table}}__guest_capable_guard
  BEFORE UPDATE ON public.{{table}}
  FOR EACH ROW EXECUTE FUNCTION platform.guest_capable_guard();
