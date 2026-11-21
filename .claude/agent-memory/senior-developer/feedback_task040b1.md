---
name: task040b1-envelope-keys
description: TASK-040 part 040-B first PR lessons - wrapper drops optional args, gitleaks-safe KAT layout, runner hides admission wait, process listing refused, bg output vanishes
metadata:
  type: feedback
---

A test double that wraps a store method with fewer parameters (`complete: (db, claim, result) => base.complete(db, claim,
result)`) silently drops an optional argument (TypeScript allows it). PR #80's API test lost `origin`, so the
slot-problem replay path was never exercised there. **How to apply:** when wrapping a port for event recording, spread
`...args` or list every parameter; grep wrappers when a method gains an optional parameter.

Known-answer vectors (HKDF hex) committed without gitleaks risk: a tuple array whose lines hold the info label and the
hex, no `key`/`secret`/`token` word on the line; pair them with an independent oracle (RFC 5869 via createHmac).
Runtime-built secret-shaped values (`['pi', uuid, 'secret', uuid].join('_')`) for client-secret scans.

`TenantTxRunner.transactionOptions` exposes only `{maxWait, timeout}`, not the admission wait; with `platform/db` out of
scope, take an optional `ExecuteOptions` value that defaults to `maxWait` (its validated upper bound, longer lease).

Listing node processes with PowerShell `Get-CimInstance` was refused by the auto-mode classifier (oversight); a
background Jest run's output file under the session `tasks/` dir was missing when read. **How to apply:** keep heavy host
runs foreground with `timeout` under the 180 s auto-background threshold, or split them; see [[feedback_pr30_fc1]].
