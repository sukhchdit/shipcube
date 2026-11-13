---
name: playwright-harness
description: Playwright/axe harness pitfalls on this Windows host (PR #4, 2026-11-12) - Firefox binary blocked, WebKit Tab, Accept-Language override, cooldown epoch, lane A base-ref step vs tools/test-support
metadata:
  type: feedback
---

Lessons from landing the PR #4 Playwright + axe harness (2026-11-12, about 110 calls, done solo).

**Why:** Each of these cost one or more debug loops. Several look like test bugs but are engine or host behaviour.

**How to apply:**
- **Cooldown epochs.** Compute the epoch from the ISO time yourself (`date -u -d <iso> +%s`). The brief's `1762978661` was 2025, one year early. Wait on the real value with `until [ "$(date -u +%s)" -ge N ]; do sleep 2; done`.
- **Firefox cannot be installed on this host.** Writing `ms-playwright\firefox-1572\firefox\firefox.exe` fails with EPERM (blocked every time; the first install finished without the exe). Chromium and WebKit install fine. Do not try to bypass it; Get-MpThreatDetection/Get-Process are denied. Report the Firefox projects as host-blocked and name lane C (Linux) as where they run. Delete the incomplete `firefox-<rev>` folder, or Playwright treats it as installed.
- **WebKit Tab.** On Windows WebKit, Tab moves focus out of the page (links are not in its tab order) and Alt+Tab does nothing. A `tabForward` fixture presses Tab on Chromium/Firefox and on WebKit focuses the first tabbable element.
- **Accept-Language.** Chromium overrides `setExtraHTTPHeaders` Accept-Language on navigations with the context locale. Test header ordering with the `request` fixture (`maxRedirects: 0`) and the browser path with `test.use({ locale })`.
- **SPA-fallback hydration.** A web `useLocale` that reads the URL breaks hydration of `index.html` served at `/es/...` (React #418, and `<html lang>` is never patched). Fix: `useSyncExternalStore` whose server snapshot is `document.documentElement.lang` (the rendered locale), or the URL locale when there is no `document`.
- **Lane A base-ref lint step** (`ci.yml`, PR2-SEC-08) `rm -rf tools/test-support` and checks out the base copy before it runs Jest. Any head-only file that `jest.config.ts` references from there breaks config validation. Keep new Jest env/setup files elsewhere (`tools/test-dom`). Reproduce the step locally with its exact commands, then run `git rm` again: its `git checkout HEAD -- tools/test-support` restores files that are moved but not yet committed.
- **Main's `tools/repo/gitignore.test.ts`** wants `.stylelintignore` lines to equal the normalised ESLint globs: `**/x/**` becomes `/**/x/`.
- **Gitleaks contamination** (see [[lane-a-merge-pitfalls]]): I ran it before the push, saw main's since-scrubbed literal in my merge diff, ran `reset --hard <branch head>`, re-merged the newer main and cherry-picked the harness. The range came out clean.
- Ran e2e as two invocations: 4 projects `--workers=2` (~70 s), Firefox separately. One all-6 run hung past 580 s.

Related: [[merge-main-pass]], [[lane-a-pr-hygiene]], [[p5-dispatch]]

**PR #4 fix cycle 2 (2026-11-13): WebKit-desktop on this host is flaky beyond the close hang.** Three sequential `--workers=1` runs:
- run 1: SPA-fallback test saw `lang=en` after releasing held scripts, then a page-teardown hang;
- run 2: `browserContext.newPage: Protocol error (Network.setEmulateOfflineState)`;
- run 3: 13/13, then the known close hang.

Each hung run leaves an orphan `WebKitNetworkProcess.exe`. Find yours by CreationDate with `Get-CimInstance Win32_Process -Filter "Name like 'WebKit%'"`, then `taskkill //PID n //F` only your own. Wrap every run in `timeout 400`. Report the failed runs honestly; don't retry more than about twice.
