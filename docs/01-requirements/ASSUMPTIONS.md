# Assumptions Register
| ID | Assumption / default applied | Source | Confidence | Validation |
|---|---|---|---|---|
| A-001 | Scope is M0 + M1; M2–M5 are backlog | Human instruction, D-001 | High | — |
| A-002 | No carrier/Stripe sandbox credentials during this run; fixtures + Mock carry tests; live sandbox demo deferred to COND-SANDBOX-DEMO | Q-001, D-003 | High | Run `CARRIER_LIVE_SANDBOX=1` suite once creds supplied |
| A-003 | Brief §14 defaults #1–#13 apply unchanged | Brief §14, D-007 | Medium | Operator review |
| A-004 | Staging = local docker compose; no prod target; $0 cloud spend | CLAUDE.md §3, D-002 | High | — |
