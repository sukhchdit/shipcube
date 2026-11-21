---
name: task051-fc1
description: TASK-051 fc1 lessons - shared scratchpad collisions, commitlint footer trap for decision lists, node gitleaks generic-api-key emulator with positive control, supersede via merge-tree
metadata:
  type: feedback
---

- The session scratchpad is SHARED with other agent sessions (it held other agents' msg1.txt etc.). Always work in a
  private subfolder (e.g. `scratchpad/t051fc1/`) and never `rm` generic names there.
  **Why:** I overwrote/deleted another session's msg1-3.txt by using generic names. **How to apply:** mkdir a task
  subfolder first; name files after the task.
- commitlint `footer-leading-blank` warns when a `D-TASKnnn-01: ...` line directly follows a non-blank line: the parser
  takes `TOKEN: text` lines as trailers. Put a blank line before a decision list in a squash body.
- gitleaks generic-api-key has no digit check; keyword (key/token/api/auth/secret...) + up to 20 word chars + `,`/`:`/`=`
  + a 10+ run of `[\w.=-]` with entropy > 3.5 fires, backticks included. A node emulator over `git log -p -U0` added
  lines reproduced the real finding exactly (positive control on the known commit) - keep one in the task scratch
  folder and scan the whole supersede range before handing back. Prose like "key ..., comma-separated" scores ~3.3.
- Supersede recipe that worked: `git merge-tree --write-tree <fix head> origin/main` -> `git commit-tree <tree> -p
  origin/main -F msg` -> `git branch <v2> <commit>`; prove with `git diff <fix head> <v2> --name-only` = docs only.
- Bash heredocs that contain JS template literals with backticks and `${}` broke the Bash tool parse; use Write for
  scripts/messages and the Edit tool for multi-line source edits (see [[pr23-fc1]]).
