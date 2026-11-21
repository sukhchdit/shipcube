---
name: task051-tags
description: TASK-051 R2-m1 title-tag commit; stale scratch msg.txt got committed because Write failed in the same parallel block as git commit -F
metadata:
  type: feedback
---

Never issue `Write <msg file>` and `git commit -F <msg file>` in the same parallel tool block, and never reuse a generic name such as `msg.txt` in the scratchpad.

**Why:** On 2026-11-21 (TASK-051 R2-m1), the scratchpad already held a `msg.txt` from another session. Write refused it ("not read yet"), but the parallel Bash still ran `git commit -F msg.txt` and committed with another task's message (`docs(sdlc): d-qg-005 ...`). It was fixed by amending the unpushed commit, which is a local history rewrite that should have been avoided.

**How to apply:**
- Give each commit message file a unique name (`task<id>-<slug>-msg.txt`).
- Run the commit only after the Write result confirms success.
- Run `git log -1 --format=%s` before you push.

Title-tag convention notes from the same task:
- New SEC-TC IDs go after the existing SEC-TC tags and before the D-ARCH/PR tags (`[SEC-TC-76] [SEC-TC-80] [D-ARCH-162]`).
- On AT titles the SEC-TC tag follows the AT ID (`[AT-US-080-02] [SEC-TC-80]`).
- Prettier re-wraps `it.each(...)(title, fn)` calls once a title passes the print width, so run `prettier --write` and mention the wrap in the commit body.

Related: [[task051-guest-claim]], [[p5-worktrees]]
