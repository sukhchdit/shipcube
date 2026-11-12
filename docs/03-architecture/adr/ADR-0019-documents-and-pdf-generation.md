# ADR-0019: Documents — pdfkit for generated PDFs (not headless Chromium), versioning and hashing

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §3.2 ("pdfkit or headless Chromium"), §4.13 documents, §4.10 files; REQ-DOC-001..015, DR-B26; D-015, D-025; NFR-OPS-002 (image size), NFR-SEC-013; ADR-0021 (storage)

## Context

M1 generates: commercial or pro-forma invoice (English, D-015/A-069), and stores carrier-produced labels and customs documents; later: pickup manifest, tax invoice, credit note, audit report (M2+). Documents are versioned and hashed (DR-B26), stored in object storage with pre-signed downloads (D-025). The choice is pdfkit (programmatic PDF, MIT, 0.20.2, maintained 2026-09) vs headless Chromium (HTML/CSS → PDF via Playwright/Puppeteer).

| Criterion | pdfkit | Headless Chromium |
|---|---|---|
| Image size / attack surface (NFR-OPS-002 ≤ 300 MB) | +~2 MB | +350–450 MB, many native libs, CVE stream |
| Determinism and hashing (DR-B26 identical bytes → no new version) | Deterministic given fixed fonts and metadata (set `CreationDate`/`ID` explicitly) | Non-deterministic metadata/timestamps unless patched |
| Layout richness / localisation | Programmatic layout; Unicode via embedded Noto Sans (en/es/fr accents) | CSS layout, easy templates, RTL later |
| Worker memory/CPU per document | Low (streams) | High (browser process pool) |
| Developer velocity for invoices/labels | Medium (layout DSL to write once) | High |

## Decision

**pdfkit** for all Platform-generated PDFs in M1, with a small internal layout kit (`packages/shared` has no PDF code; `apps/api/src/modules/documents/render/*` holds `invoiceTemplate(data, locale)` built on primitives: header, address blocks, line-item table with page breaks, totals, footer with hash and version). Fonts: Noto Sans (OFL-1.1 — font licence, not a code dependency; recorded in D-ARCH-003) embedded from `apps/api/assets/fonts`. Deterministic output: fixed `info` (`Producer`, `Creator`), explicit `CreationDate` = document `issued_at`, no random `/ID`; identical input → identical bytes → no new version (DR-B26). Labels are **not** generated — carriers return PDF/PNG/ZPL bytes which are stored as-is with their format (REQ-DOC). `documents(id, shipment_id, type, version, status CURRENT|SUPERSEDED|VOIDED, format, storage_key, sha256, size_bytes, locale, issued_at)`. Generation runs in the worker (`documents` queue) as saga step 4; downloads via `GET /documents/{id}/download` → permission check (`document:download`) → `DOWNLOAD` audit entry → pre-signed URL 300 s (ADR-0021). E-mailing documents (REQ-DOC-010): attachments ≤ 10 MB else link, only to the verified account e-mail (A-072). Revisit for the M2 regulator report/tax invoice: if the HTML-template route is needed then, a **separate** `pdf-renderer` worker image with Chromium is the extension point (keeps api/worker images small).

## Alternatives considered

Headless Chromium (table above) — rejected for M1 on image size, determinism and worker footprint; `@react-pdf/renderer` — React-based layout, MIT, attractive but adds a React runtime to the worker and its determinism is similar to pdfkit's; kept as a possible successor if templates multiply.

## Consequences

- Positive: small images, deterministic hashes, low memory.
- Negative: layout code is hand-written; complex multi-locale documents later may motivate the renderer image.
- Verification: golden-PDF byte-equality tests per template and locale; hash tests; pre-signed URL TTL and audit tests (NFR-SEC-013).

## Reversibility

High (renderer is behind `DocumentRenderer` port).
