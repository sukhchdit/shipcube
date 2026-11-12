---
description: Start a fully autonomous SDLC run from an idea, brief, or path to a requirements document
argument-hint: <product idea text | path/to/brief.md>
---
Start a new autonomous SDLC run as sdlc-orchestrator.

Input: $ARGUMENTS

1. If the input is a file path, read it; otherwise treat it as the idea text. Save it verbatim, plus your structured summary, to `docs/sdlc/BRIEF.md`.
2. Create `docs/sdlc/STATUS.md` from the template, and empty `DECISIONS.md` and `QUESTIONS.md`.
3. Create Task list items for P0–P7.
4. Resolve the Operating Parameters (CLAUDE.md §3) from the brief or the defaults.
5. If high-impact unknowns remain, ask them in ONE batch, each with a recommended default. Apply the defaults for anything unanswered and continue immediately.
6. Run the pipeline to completion per CLAUDE.md §6, without pausing between phases.
