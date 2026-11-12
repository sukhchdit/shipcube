---
name: d059-batch3-alignment
description: P5 Wave 0 ruling D-059 (A-105..A-107) — how the architect's wave-0 batch-3 rulings (D-ARCH-057..062) were mirrored on the requirement side: Platform-side void, recoverLabel, token-endpoint failure path, README diff field, no push scheme; v1.6 baselines and pairs that move together.
metadata:
  type: project
---

D-059 (2026-11-12, P5 Wave 0): product-manager mirrored the architect's batch-3 rulings (`docs/03-architecture/rulings/wave-0-batch-3-rulings.md`, D-ARCH-057..062, ADR-0010 am. 11) into REQUIREMENTS 1.6 / PRD 1.6 / NFR 1.5 (NFR-RES-003 pool list only). traceability.md untouched; counts still 434/91/293/134.

**What changed:** cancellation when the adapter cannot void (DHL Express `operations.cancelShipment=false`) → `carrier_void = UNSUPPORTED`, pickup cancelled, label VOIDED Platform-side, refund proceeds, never EXCEPTION (REQ-BOOK-029/030, REQ-DOC-013, DR-B21; US-196/215/229). REQ-CARR-003 guard covers any declared-unsupported operation; `recoverLabel` is an optional op in REQ-CARR-001, retryable + `transactional` pool (REQ-CARR-017, DR-B32, NFR-RES-003, US-121/130). REQ-CARR-016 token-endpoint failure path (negative cache 60 s, per-carrier bucket, 403 → 600 s cool-down with `CARRIER_UNAVAILABLE`; US-129, SEC-TC-68). REQ-CARR-019 README line `Diffed against official spec by a person: yes (date, role) | no` (US-137). REQ-TRACK-006: `pushTracking=false` ×3, Platform HMAC only (US-252; live scenario skipped). REQ-DOC-002 satisfied for UPS via Label Recovery (`labelFormats=[PDF_4X6, ZPL]`; R-ARCH-25; US-222). DR-A07 already aligned by D-058 — no edit needed.

**Why:** conformance reviews judge code against REQs and ADRs together; a REQ still saying "void the carrier shipment" would fail the accepted DHL design. Refund still proceeds because D-017 is the product promise; the carrier-cost exposure is an assumption (A-105) validated at COND-SANDBOX-DEMO, not a reason to withhold money.

**How to apply:** New pairs that move together: carrier void semantics → REQ-BOOK-029/030 + REQ-DOC-013 + DR-B21 + US-196/215/229 + A-105; adapter operation list → REQ-CARR-001/002/003/017 + DR-B32 + NFR-RES-003 + US-121/130; token cache → REQ-CARR-016 + US-129 + DR-B32 token sentence; README fields → REQ-CARR-019 + US-137; push tracking → REQ-TRACK-006 + REQ-CARR-002 seeds + US-252 + A-107; UPS labels → REQ-DOC-002 note + US-222 + A-106 + R-ARCH-25. If CIE shows no PDF via Label Recovery and the documents-module converter also fails, the last resort is a PM re-scope of REQ-DOC-002 for UPS to ZPL-only (REQ-DOC-015 path) — log it as a new D-0xx. Stale-string watch: "void the carrier shipment" without the "where the adapter supports it" qualifier; "a boolean per optional operation" without `operations.cancelShipment`.
