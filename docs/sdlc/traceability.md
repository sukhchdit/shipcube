# Traceability Matrix
Version 1.3 · 2026-11-12 · maintained by product-manager (P1), extended by principal-architect (Design), senior-developer (Tasks), qa-lead (Tests).
Status values: Specified → Designed → Planned → Implemented → Verified.
v1.3 (P3 security remediation, D-046..D-052, see PRD §11): REQ-AUTH-020/021/022 Should → Must; new REQ-AUTH-025 (M1 Must), REQ-AUTH-026 (M0 Must), REQ-CARR-022 and REQ-CARR-023 (M1 Must); new Must stories US-291 (EPIC-02, M1), US-292 (EPIC-02, M0), US-293 (EPIC-06, M1); US-027 Should → Must. None of the new or promoted stories is demo-critical (DC set unchanged at 134). Tables below regenerated from the files on 2026-11-12.
v1.2 (P3 alignment, D-038..D-045): wording-only amendments to REQUIREMENTS.md 1.2, NFR.md 1.2 and the stories (see PRD §11); no REQ or story IDs, links, priorities, milestones or DC tags changed, so every count below is unchanged and was re-verified against the files on 2026-11-12. The Design column is populated by principal-architect at G2.
v1.1 (G1 condition closure): tags corrected per D-036; DC (demo-critical) column added to "Story → Requirement" per D-037; early-delivery notes and NFR traceability link added.

## Summary
| Metric | Value |
|---|---|
| Total REQs | 434 (324 Must · 91 Should · 19 Could; 205 M0 · 229 M1) |
| REQs linked by ≥1 story | 434 |
| Orphan REQs | 0 |
| Total stories | 293 |
| Stories per MoSCoW | Must 218 · Should 67 · Could 8 |
| Stories per milestone | M0 120 · M1 173 |
| Demo-critical (DC) stories (D-037) | 134 (M0 74 · M1 60) of 218 Must |
| Must REQs not linked by a Must story | 0 |

**Early delivery (G1-C2 note).** Four M1 REQs are delivered by M0 stories and are therefore available from R0: REQ-DATA-014 (FX seed) by US-052, REQ-SEC-008 (Joi/Zod parity) by US-046, REQ-QUOTE-004 (package limits) by US-156 (all Must), and REQ-AUDIT-018 (archiver seam, Could) by US-100 (Should). Their M1 tag is kept because M1 is the first milestone that needs them; the R0 regression may already exercise them. These are the only REQs whose milestone differs from every linked story (verified 2026-11-12).

| Epic | File | Stories | Must | Should | Could | M0 | M1 |
|---|---|---|---|---|---|---|---|
| EPIC-01 | stories/EPIC-01-platform-foundation.md | 14 | 12 | 2 | 0 | 14 | 0 |
| EPIC-02 | stories/EPIC-02-identity-sessions.md | 21 | 17 | 4 | 0 | 17 | 4 |
| EPIC-03 | stories/EPIC-03-organisations-rbac-tenancy.md | 25 | 19 | 6 | 0 | 19 | 6 |
| EPIC-04 | stories/EPIC-04-audit-trail-viewer.md | 15 | 13 | 2 | 0 | 14 | 1 |
| EPIC-05 | stories/EPIC-05-design-system-shells-i18n.md | 20 | 17 | 3 | 0 | 14 | 6 |
| EPIC-06 | stories/EPIC-06-carrier-integration.md | 18 | 18 | 0 | 0 | 6 | 12 |
| EPIC-07 | stories/EPIC-07-pricing-engine.md | 16 | 13 | 2 | 1 | 3 | 13 |
| EPIC-08 | stories/EPIC-08-quote-and-comparison.md | 17 | 11 | 6 | 0 | 3 | 14 |
| EPIC-09 | stories/EPIC-09-booking-wizard-customs-basket.md | 26 | 18 | 8 | 0 | 1 | 25 |
| EPIC-10 | stories/EPIC-10-payments-booking-saga.md | 23 | 18 | 5 | 0 | 9 | 14 |
| EPIC-11 | stories/EPIC-11-documents.md | 12 | 7 | 4 | 1 | 0 | 12 |
| EPIC-12 | stories/EPIC-12-pickup-and-dropoff.md | 9 | 6 | 2 | 1 | 0 | 9 |
| EPIC-13 | stories/EPIC-13-tracking.md | 13 | 9 | 3 | 1 | 0 | 13 |
| EPIC-14 | stories/EPIC-14-customer-account.md | 20 | 4 | 13 | 3 | 0 | 20 |
| EPIC-15 | stories/EPIC-15-notifications.md | 17 | 11 | 5 | 1 | 0 | 17 |
| EPIC-16 | stories/EPIC-16-api-conventions-security.md | 15 | 14 | 1 | 0 | 15 | 0 |
| EPIC-17 | stories/EPIC-17-reference-data-compliance-packs.md | 12 | 11 | 1 | 0 | 5 | 7 |
| **Total** | 17 files | 293 | 218 | 67 | 8 | 120 | 173 |

## Requirement → Story
| REQ | MS | MoSCoW | Story | Design (ADR/Spec) | Task(s) | Test(s) | Status |
|---|---|---|---|---|---|---|---|
| REQ-PLAT-001 | M0 | Must | US-001 | – | – | – | Specified |
| REQ-PLAT-002 | M0 | Must | US-001 | – | – | – | Specified |
| REQ-PLAT-003 | M0 | Must | US-001 | – | – | – | Specified |
| REQ-PLAT-004 | M0 | Must | US-002 | – | – | – | Specified |
| REQ-PLAT-005 | M0 | Must | US-003 | – | – | – | Specified |
| REQ-PLAT-006 | M0 | Must | US-004 | – | – | – | Specified |
| REQ-PLAT-007 | M0 | Must | US-005 | – | – | – | Specified |
| REQ-PLAT-008 | M0 | Must | US-006 | – | – | – | Specified |
| REQ-PLAT-009 | M0 | Must | US-007 | – | – | – | Specified |
| REQ-PLAT-010 | M0 | Must | US-007 | – | – | – | Specified |
| REQ-PLAT-011 | M0 | Must | US-008 | – | – | – | Specified |
| REQ-PLAT-012 | M0 | Must | US-008 | – | – | – | Specified |
| REQ-PLAT-013 | M0 | Must | US-009 | – | – | – | Specified |
| REQ-PLAT-014 | M0 | Must | US-010 | – | – | – | Specified |
| REQ-PLAT-015 | M0 | Must | US-010 | – | – | – | Specified |
| REQ-PLAT-016 | M0 | Must | US-011 | – | – | – | Specified |
| REQ-PLAT-017 | M0 | Must | US-011 | – | – | – | Specified |
| REQ-PLAT-018 | M0 | Must | US-012 | – | – | – | Specified |
| REQ-PLAT-019 | M0 | Should | US-013 | – | – | – | Specified |
| REQ-PLAT-020 | M0 | Should | US-014 | – | – | – | Specified |
| REQ-PLAT-021 | M0 | Should | US-014 | – | – | – | Specified |
| REQ-PLAT-022 | M0 | Could | US-013 | – | – | – | Specified |
| REQ-AUTH-001 | M0 | Must | US-015 | – | – | – | Specified |
| REQ-AUTH-002 | M0 | Must | US-015 | – | – | – | Specified |
| REQ-AUTH-003 | M0 | Must | US-015 | – | – | – | Specified |
| REQ-AUTH-004 | M0 | Must | US-016 | – | – | – | Specified |
| REQ-AUTH-005 | M0 | Must | US-017 | – | – | – | Specified |
| REQ-AUTH-006 | M0 | Must | US-018 | – | – | – | Specified |
| REQ-AUTH-007 | M0 | Must | US-018 | – | – | – | Specified |
| REQ-AUTH-008 | M0 | Must | US-018 | – | – | – | Specified |
| REQ-AUTH-009 | M0 | Must | US-019 | – | – | – | Specified |
| REQ-AUTH-010 | M0 | Must | US-020 | – | – | – | Specified |
| REQ-AUTH-011 | M0 | Must | US-021 | – | – | – | Specified |
| REQ-AUTH-012 | M0 | Must | US-021 | – | – | – | Specified |
| REQ-AUTH-013 | M0 | Must | US-022 | – | – | – | Specified |
| REQ-AUTH-014 | M0 | Must | US-022 | – | – | – | Specified |
| REQ-AUTH-015 | M0 | Must | US-023 | – | – | – | Specified |
| REQ-AUTH-016 | M0 | Must | US-023 | – | – | – | Specified |
| REQ-AUTH-017 | M0 | Must | US-024 | – | – | – | Specified |
| REQ-AUTH-018 | M0 | Must | US-025 | – | – | – | Specified |
| REQ-AUTH-019 | M1 | Should | US-026 | – | – | – | Specified |
| REQ-AUTH-020 | M1 | Must | US-026, US-291 | – | – | – | Specified |
| REQ-AUTH-021 | M1 | Must | US-027 | – | – | – | Specified |
| REQ-AUTH-022 | M1 | Must | US-027 | – | – | – | Specified |
| REQ-AUTH-023 | M1 | Should | US-028 | – | – | – | Specified |
| REQ-AUTH-024 | M0 | Should | US-029 | – | – | – | Specified |
| REQ-AUTH-025 | M1 | Must | US-291 | – | – | – | Specified |
| REQ-AUTH-026 | M0 | Must | US-292 | – | – | – | Specified |
| REQ-ORG-001 | M0 | Must | US-061 | – | – | – | Specified |
| REQ-ORG-002 | M0 | Must | US-062 | – | – | – | Specified |
| REQ-ORG-003 | M0 | Must | US-062 | – | – | – | Specified |
| REQ-ORG-004 | M0 | Must | US-062 | – | – | – | Specified |
| REQ-ORG-005 | M0 | Must | US-063 | – | – | – | Specified |
| REQ-ORG-006 | M1 | Should | US-081 | – | – | – | Specified |
| REQ-ORG-007 | M0 | Must | US-064 | – | – | – | Specified |
| REQ-ORG-008 | M1 | Should | US-082 | – | – | – | Specified |
| REQ-ORG-009 | M1 | Should | US-082 | – | – | – | Specified |
| REQ-ORG-010 | M1 | Should | US-083 | – | – | – | Specified |
| REQ-ORG-011 | M1 | Should | US-084 | – | – | – | Specified |
| REQ-ORG-012 | M1 | Should | US-085 | – | – | – | Specified |
| REQ-ORG-013 | M1 | Should | US-085 | – | – | – | Specified |
| REQ-ORG-014 | M1 | Should | US-085 | – | – | – | Specified |
| REQ-RBAC-001 | M0 | Must | US-065 | – | – | – | Specified |
| REQ-RBAC-002 | M0 | Must | US-066 | – | – | – | Specified |
| REQ-RBAC-003 | M0 | Should | US-066 | – | – | – | Specified |
| REQ-RBAC-004 | M0 | Must | US-066 | – | – | – | Specified |
| REQ-RBAC-005 | M0 | Must | US-067 | – | – | – | Specified |
| REQ-RBAC-006 | M0 | Must | US-068 | – | – | – | Specified |
| REQ-RBAC-007 | M0 | Must | US-069 | – | – | – | Specified |
| REQ-RBAC-008 | M0 | Must | US-068 | – | – | – | Specified |
| REQ-RBAC-009 | M0 | Must | US-070 | – | – | – | Specified |
| REQ-RBAC-010 | M0 | Must | US-070 | – | – | – | Specified |
| REQ-RBAC-011 | M0 | Must | US-071 | – | – | – | Specified |
| REQ-RBAC-012 | M1 | Must | US-072 | – | – | – | Specified |
| REQ-RBAC-013 | M0 | Should | US-073 | – | – | – | Specified |
| REQ-RBAC-014 | M0 | Must | US-065 | – | – | – | Specified |
| REQ-AUDIT-001 | M0 | Must | US-086 | – | – | – | Specified |
| REQ-AUDIT-002 | M0 | Must | US-087 | – | – | – | Specified |
| REQ-AUDIT-003 | M0 | Must | US-087 | – | – | – | Specified |
| REQ-AUDIT-004 | M0 | Must | US-088 | – | – | – | Specified |
| REQ-AUDIT-005 | M0 | Must | US-089 | – | – | – | Specified |
| REQ-AUDIT-006 | M0 | Must | US-086 | – | – | – | Specified |
| REQ-AUDIT-007 | M0 | Must | US-090 | – | – | – | Specified |
| REQ-AUDIT-008 | M0 | Must | US-091 | – | – | – | Specified |
| REQ-AUDIT-009 | M0 | Must | US-091 | – | – | – | Specified |
| REQ-AUDIT-010 | M0 | Must | US-088 | – | – | – | Specified |
| REQ-AUDIT-011 | M0 | Must | US-087 | – | – | – | Specified |
| REQ-AUDIT-012 | M0 | Must | US-092 | – | – | – | Specified |
| REQ-AUDIT-013 | M0 | Must | US-093 | – | – | – | Specified |
| REQ-AUDIT-014 | M0 | Must | US-094 | – | – | – | Specified |
| REQ-AUDIT-015 | M0 | Must | US-094 | – | – | – | Specified |
| REQ-AUDIT-016 | M0 | Must | US-095 | – | – | – | Specified |
| REQ-AUDIT-017 | M0 | Must | US-095 | – | – | – | Specified |
| REQ-AUDIT-018 | M1 | Could | US-100 | – | – | – | Specified |
| REQ-AUDIT-019 | M0 | Must | US-097 | – | – | – | Specified |
| REQ-AUDIT-020 | M0 | Must | US-098 | – | – | – | Specified |
| REQ-AUDIT-021 | M1 | Should | US-099 | – | – | – | Specified |
| REQ-AUDIT-022 | M0 | Must | US-098 | – | – | – | Specified |
| REQ-AUDIT-023 | M0 | Must | US-097 | – | – | – | Specified |
| REQ-AUDIT-024 | M0 | Must | US-096 | – | – | – | Specified |
| REQ-AUDIT-025 | M0 | Should | US-100 | – | – | – | Specified |
| REQ-RLS-001 | M0 | Must | US-074 | – | – | – | Specified |
| REQ-RLS-002 | M0 | Must | US-074 | – | – | – | Specified |
| REQ-RLS-003 | M0 | Must | US-075 | – | – | – | Specified |
| REQ-RLS-004 | M0 | Must | US-075 | – | – | – | Specified |
| REQ-RLS-005 | M0 | Must | US-074 | – | – | – | Specified |
| REQ-RLS-006 | M0 | Must | US-076 | – | – | – | Specified |
| REQ-RLS-007 | M0 | Must | US-077 | – | – | – | Specified |
| REQ-RLS-008 | M0 | Must | US-078 | – | – | – | Specified |
| REQ-RLS-009 | M0 | Must | US-064 | – | – | – | Specified |
| REQ-RLS-010 | M0 | Must | US-079 | – | – | – | Specified |
| REQ-RLS-011 | M0 | Must | US-079 | – | – | – | Specified |
| REQ-RLS-012 | M0 | Must | US-064 | – | – | – | Specified |
| REQ-RLS-013 | M0 | Must | US-080 | – | – | – | Specified |
| REQ-DATA-001 | M0 | Must | US-049 | – | – | – | Specified |
| REQ-DATA-002 | M0 | Must | US-049 | – | – | – | Specified |
| REQ-DATA-003 | M0 | Must | US-050 | – | – | – | Specified |
| REQ-DATA-004 | M0 | Must | US-051 | – | – | – | Specified |
| REQ-DATA-005 | M0 | Must | US-051 | – | – | – | Specified |
| REQ-DATA-006 | M0 | Must | US-052 | – | – | – | Specified |
| REQ-DATA-007 | M0 | Must | US-051 | – | – | – | Specified |
| REQ-DATA-008 | M1 | Must | US-054 | – | – | – | Specified |
| REQ-DATA-009 | M1 | Must | US-054 | – | – | – | Specified |
| REQ-DATA-010 | M1 | Must | US-054 | – | – | – | Specified |
| REQ-DATA-011 | M1 | Must | US-055 | – | – | – | Specified |
| REQ-DATA-012 | M1 | Must | US-054 | – | – | – | Specified |
| REQ-DATA-013 | M1 | Must | US-054 | – | – | – | Specified |
| REQ-DATA-014 | M1 | Must | US-052 | – | – | – | Specified |
| REQ-DATA-015 | M1 | Must | US-056 | – | – | – | Specified |
| REQ-DATA-016 | M0 | Must | US-053 | – | – | – | Specified |
| REQ-DATA-017 | M1 | Could | US-056 | – | – | – | Specified |
| REQ-COMP-001 | M1 | Must | US-057 | – | – | – | Specified |
| REQ-COMP-002 | M1 | Must | US-057 | – | – | – | Specified |
| REQ-COMP-003 | M1 | Must | US-058 | – | – | – | Specified |
| REQ-COMP-004 | M1 | Must | US-059 | – | – | – | Specified |
| REQ-COMP-005 | M1 | Must | US-059 | – | – | – | Specified |
| REQ-COMP-006 | M1 | Must | US-059 | – | – | – | Specified |
| REQ-COMP-007 | M1 | Should | US-060 | – | – | – | Specified |
| REQ-COMP-008 | M1 | Should | US-058 | – | – | – | Specified |
| REQ-UI-001 | M0 | Must | US-101 | – | – | – | Specified |
| REQ-UI-002 | M0 | Must | US-102 | – | – | – | Specified |
| REQ-UI-003 | M0 | Must | US-103 | – | – | – | Specified |
| REQ-UI-004 | M0 | Must | US-103 | – | – | – | Specified |
| REQ-UI-005 | M0 | Must | US-103 | – | – | – | Specified |
| REQ-UI-006 | M0 | Must | US-104 | – | – | – | Specified |
| REQ-UI-007 | M0 | Must | US-104 | – | – | – | Specified |
| REQ-UI-008 | M0 | Must | US-105 | – | – | – | Specified |
| REQ-UI-009 | M0 | Must | US-105 | – | – | – | Specified |
| REQ-UI-010 | M0 | Must | US-106 | – | – | – | Specified |
| REQ-UI-011 | M0 | Must | US-107 | – | – | – | Specified |
| REQ-UI-012 | M0 | Must | US-107 | – | – | – | Specified |
| REQ-UI-013 | M0 | Must | US-108 | – | – | – | Specified |
| REQ-UI-014 | M1 | Must | US-109 | – | – | – | Specified |
| REQ-UI-015 | M1 | Must | US-109 | – | – | – | Specified |
| REQ-UI-016 | M0 | Must | US-110 | – | – | – | Specified |
| REQ-UI-017 | M1 | Could | US-111 | – | – | – | Specified |
| REQ-UI-018 | M1 | Should | US-111 | – | – | – | Specified |
| REQ-UI-019 | M1 | Must | US-112 | – | – | – | Specified |
| REQ-UI-020 | M0 | Must | US-113 | – | – | – | Specified |
| REQ-UI-021 | M0 | Must | US-113 | – | – | – | Specified |
| REQ-UI-022 | M0 | Must | US-106 | – | – | – | Specified |
| REQ-UI-023 | M1 | Should | US-114 | – | – | – | Specified |
| REQ-I18N-001 | M0 | Must | US-115 | – | – | – | Specified |
| REQ-I18N-002 | M0 | Must | US-115 | – | – | – | Specified |
| REQ-I18N-003 | M0 | Must | US-115 | – | – | – | Specified |
| REQ-I18N-004 | M0 | Must | US-116 | – | – | – | Specified |
| REQ-I18N-005 | M1 | Must | US-119 | – | – | – | Specified |
| REQ-I18N-006 | M0 | Must | US-117 | – | – | – | Specified |
| REQ-I18N-007 | M0 | Must | US-117 | – | – | – | Specified |
| REQ-I18N-008 | M0 | Must | US-117 | – | – | – | Specified |
| REQ-I18N-009 | M0 | Must | US-120 | – | – | – | Specified |
| REQ-I18N-010 | M0 | Should | US-120 | – | – | – | Specified |
| REQ-I18N-011 | M0 | Must | US-116 | – | – | – | Specified |
| REQ-I18N-012 | M1 | Should | US-118 | – | – | – | Specified |
| REQ-I18N-013 | M0 | Should | US-115 | – | – | – | Specified |
| REQ-I18N-014 | M0 | Could | US-116 | – | – | – | Specified |
| REQ-API-001 | M0 | Must | US-034 | – | – | – | Specified |
| REQ-API-002 | M0 | Must | US-034 | – | – | – | Specified |
| REQ-API-003 | M0 | Should | US-035 | – | – | – | Specified |
| REQ-API-004 | M0 | Must | US-034 | – | – | – | Specified |
| REQ-API-005 | M0 | Must | US-036 | – | – | – | Specified |
| REQ-API-006 | M0 | Must | US-036 | – | – | – | Specified |
| REQ-API-007 | M0 | Must | US-037 | – | – | – | Specified |
| REQ-API-008 | M0 | Must | US-037 | – | – | – | Specified |
| REQ-API-009 | M0 | Must | US-038 | – | – | – | Specified |
| REQ-API-010 | M0 | Must | US-038 | – | – | – | Specified |
| REQ-API-011 | M0 | Must | US-038 | – | – | – | Specified |
| REQ-API-012 | M0 | Should | US-039 | – | – | – | Specified |
| REQ-API-013 | M0 | Must | US-039 | – | – | – | Specified |
| REQ-API-014 | M0 | Must | US-040 | – | – | – | Specified |
| REQ-API-015 | M0 | Could | US-035 | – | – | – | Specified |
| REQ-API-016 | M0 | Must | US-041 | – | – | – | Specified |
| REQ-API-017 | M0 | Must | US-042 | – | – | – | Specified |
| REQ-API-018 | M0 | Must | US-042 | – | – | – | Specified |
| REQ-API-019 | M0 | Should | US-035 | – | – | – | Specified |
| REQ-API-020 | M0 | Could | US-035 | – | – | – | Specified |
| REQ-SEC-001 | M0 | Must | US-043 | – | – | – | Specified |
| REQ-SEC-002 | M0 | Must | US-043 | – | – | – | Specified |
| REQ-SEC-003 | M0 | Must | US-043 | – | – | – | Specified |
| REQ-SEC-004 | M0 | Must | US-044 | – | – | – | Specified |
| REQ-SEC-005 | M0 | Must | US-040 | – | – | – | Specified |
| REQ-SEC-006 | M0 | Should | US-040 | – | – | – | Specified |
| REQ-SEC-007 | M0 | Must | US-045 | – | – | – | Specified |
| REQ-SEC-008 | M1 | Must | US-046 | – | – | – | Specified |
| REQ-SEC-009 | M0 | Must | US-046 | – | – | – | Specified |
| REQ-SEC-010 | M0 | Must | US-047 | – | – | – | Specified |
| REQ-SEC-011 | M0 | Must | US-048 | – | – | – | Specified |
| REQ-SEC-012 | M0 | Must | US-047 | – | – | – | Specified |
| REQ-SEC-013 | M0 | Must | US-048 | – | – | – | Specified |
| REQ-SEC-014 | M0 | Must | US-044 | – | – | – | Specified |
| REQ-SEC-015 | M0 | Should | US-045 | – | – | – | Specified |
| REQ-SEC-016 | M0 | Should | US-046 | – | – | – | Specified |
| REQ-ADMIN-001 | M0 | Must | US-030 | – | – | – | Specified |
| REQ-ADMIN-002 | M0 | Must | US-031 | – | – | – | Specified |
| REQ-ADMIN-003 | M0 | Must | US-030 | – | – | – | Specified |
| REQ-ADMIN-004 | M0 | Should | US-033 | – | – | – | Specified |
| REQ-ADMIN-005 | M0 | Must | US-032 | – | – | – | Specified |
| REQ-ADMIN-006 | M0 | Must | US-032 | – | – | – | Specified |
| REQ-ADMIN-007 | M1 | Should | US-027 | – | – | – | Specified |
| REQ-ADMIN-008 | M1 | Should | US-026 | – | – | – | Specified |
| REQ-ADMIN-009 | M0 | Must | US-032 | – | – | – | Specified |
| REQ-ADMIN-010 | M0 | Should | US-033 | – | – | – | Specified |
| REQ-CARR-001 | M0 | Must | US-121 | – | – | – | Specified |
| REQ-CARR-002 | M0 | Must | US-121 | – | – | – | Specified |
| REQ-CARR-003 | M0 | Must | US-121 | – | – | – | Specified |
| REQ-CARR-004 | M0 | Must | US-122 | – | – | – | Specified |
| REQ-CARR-005 | M0 | Must | US-123 | – | – | – | Specified |
| REQ-CARR-006 | M0 | Must | US-123 | – | – | – | Specified |
| REQ-CARR-007 | M0 | Must | US-124 | – | – | – | Specified |
| REQ-CARR-008 | M0 | Must | US-126 | – | – | – | Specified |
| REQ-CARR-009 | M1 | Must | US-135 | – | – | – | Specified |
| REQ-CARR-010 | M1 | Must | US-134 | – | – | – | Specified |
| REQ-CARR-011 | M0 | Must | US-125 | – | – | – | Specified |
| REQ-CARR-012 | M1 | Must | US-131 | – | – | – | Specified |
| REQ-CARR-013 | M1 | Must | US-132 | – | – | – | Specified |
| REQ-CARR-014 | M1 | Must | US-133 | – | – | – | Specified |
| REQ-CARR-015 | M1 | Must | US-128 | – | – | – | Specified |
| REQ-CARR-016 | M1 | Must | US-129 | – | – | – | Specified |
| REQ-CARR-017 | M1 | Must | US-130 | – | – | – | Specified |
| REQ-CARR-018 | M1 | Must | US-136 | – | – | – | Specified |
| REQ-CARR-019 | M1 | Must | US-137 | – | – | – | Specified |
| REQ-CARR-020 | M1 | Should | US-137 | – | – | – | Specified |
| REQ-CARR-021 | M1 | Must | US-127 | – | – | – | Specified |
| REQ-CARR-022 | M1 | Must | US-293 | – | – | – | Specified |
| REQ-CARR-023 | M1 | Must | US-293 | – | – | – | Specified |
| REQ-PRICE-001 | M0 | Must | US-138 | – | – | – | Specified |
| REQ-PRICE-002 | M0 | Must | US-138 | – | – | – | Specified |
| REQ-PRICE-003 | M0 | Must | US-140 | – | – | – | Specified |
| REQ-PRICE-004 | M0 | Must | US-139 | – | – | – | Specified |
| REQ-PRICE-005 | M1 | Must | US-141 | – | – | – | Specified |
| REQ-PRICE-006 | M1 | Must | US-142 | – | – | – | Specified |
| REQ-PRICE-007 | M1 | Must | US-142 | – | – | – | Specified |
| REQ-PRICE-008 | M1 | Must | US-143 | – | – | – | Specified |
| REQ-PRICE-009 | M1 | Should | US-144 | – | – | – | Specified |
| REQ-PRICE-010 | M1 | Should | US-145 | – | – | – | Specified |
| REQ-PRICE-011 | M1 | Should | US-145 | – | – | – | Specified |
| REQ-PRICE-012 | M1 | Could | US-153 | – | – | – | Specified |
| REQ-PRICE-013 | M1 | Must | US-146 | – | – | – | Specified |
| REQ-PRICE-014 | M1 | Must | US-147 | – | – | – | Specified |
| REQ-PRICE-015 | M1 | Must | US-148 | – | – | – | Specified |
| REQ-PRICE-016 | M1 | Must | US-149 | – | – | – | Specified |
| REQ-PRICE-017 | M1 | Must | US-150 | – | – | – | Specified |
| REQ-PRICE-018 | M1 | Should | US-144 | – | – | – | Specified |
| REQ-PRICE-019 | M1 | Must | US-151 | – | – | – | Specified |
| REQ-PRICE-020 | M1 | Must | US-152 | – | – | – | Specified |
| REQ-PRICE-021 | M1 | Could | US-153 | – | – | – | Specified |
| REQ-QUOTE-001 | M0 | Must | US-154 | – | – | – | Specified |
| REQ-QUOTE-002 | M0 | Must | US-155 | – | – | – | Specified |
| REQ-QUOTE-003 | M0 | Must | US-156 | – | – | – | Specified |
| REQ-QUOTE-004 | M1 | Must | US-156 | – | – | – | Specified |
| REQ-QUOTE-005 | M1 | Must | US-157 | – | – | – | Specified |
| REQ-QUOTE-006 | M1 | Must | US-157 | – | – | – | Specified |
| REQ-QUOTE-007 | M1 | Must | US-159 | – | – | – | Specified |
| REQ-QUOTE-008 | M1 | Must | US-160 | – | – | – | Specified |
| REQ-QUOTE-009 | M1 | Must | US-161 | – | – | – | Specified |
| REQ-QUOTE-010 | M1 | Should | US-162 | – | – | – | Specified |
| REQ-QUOTE-011 | M1 | Should | US-161 | – | – | – | Specified |
| REQ-QUOTE-012 | M1 | Must | US-159 | – | – | – | Specified |
| REQ-QUOTE-013 | M1 | Should | US-163 | – | – | – | Specified |
| REQ-QUOTE-014 | M1 | Should | US-164 | – | – | – | Specified |
| REQ-QUOTE-015 | M1 | Should | US-165 | – | – | – | Specified |
| REQ-QUOTE-016 | M1 | Must | US-166 | – | – | – | Specified |
| REQ-QUOTE-017 | M1 | Must | US-167 | – | – | – | Specified |
| REQ-QUOTE-018 | M1 | Must | US-168 | – | – | – | Specified |
| REQ-QUOTE-019 | M1 | Should | US-169 | – | – | – | Specified |
| REQ-QUOTE-020 | M1 | Should | US-170 | – | – | – | Specified |
| REQ-QUOTE-021 | M1 | Could | US-170 | – | – | – | Specified |
| REQ-QUOTE-022 | M1 | Could | US-169 | – | – | – | Specified |
| REQ-QUOTE-023 | M1 | Must | US-158 | – | – | – | Specified |
| REQ-BOOK-001 | M1 | Must | US-171 | – | – | – | Specified |
| REQ-BOOK-002 | M1 | Must | US-172 | – | – | – | Specified |
| REQ-BOOK-003 | M1 | Must | US-174 | – | – | – | Specified |
| REQ-BOOK-004 | M1 | Should | US-179 | – | – | – | Specified |
| REQ-BOOK-005 | M1 | Must | US-175 | – | – | – | Specified |
| REQ-BOOK-006 | M1 | Must | US-176 | – | – | – | Specified |
| REQ-BOOK-007 | M1 | Should | US-178 | – | – | – | Specified |
| REQ-BOOK-008 | M1 | Must | US-177 | – | – | – | Specified |
| REQ-BOOK-009 | M1 | Must | US-180 | – | – | – | Specified |
| REQ-BOOK-010 | M1 | Must | US-189 | – | – | – | Specified |
| REQ-BOOK-011 | M1 | Should | US-190 | – | – | – | Specified |
| REQ-BOOK-012 | M1 | Must | US-191 | – | – | – | Specified |
| REQ-BOOK-013 | M1 | Must | US-192 | – | – | – | Specified |
| REQ-BOOK-014 | M1 | Should | US-193 | – | – | – | Specified |
| REQ-BOOK-015 | M1 | Should | US-194 | – | – | – | Specified |
| REQ-BOOK-016 | M1 | Must | US-208 | – | – | – | Specified |
| REQ-BOOK-017 | M1 | Must | US-195 | – | – | – | Specified |
| REQ-BOOK-018 | M0 | Must | US-197 | – | – | – | Specified |
| REQ-BOOK-019 | M0 | Must | US-198 | – | – | – | Specified |
| REQ-BOOK-020 | M0 | Must | US-202 | – | – | – | Specified |
| REQ-BOOK-021 | M0 | Must | US-203 | – | – | – | Specified |
| REQ-BOOK-022 | M0 | Must | US-204 | – | – | – | Specified |
| REQ-BOOK-023 | M0 | Must | US-205 | – | – | – | Specified |
| REQ-BOOK-024 | M1 | Must | US-206 | – | – | – | Specified |
| REQ-BOOK-025 | M1 | Must | US-207 | – | – | – | Specified |
| REQ-BOOK-026 | M0 | Must | US-201 | – | – | – | Specified |
| REQ-BOOK-027 | M0 | Must | US-173 | – | – | – | Specified |
| REQ-BOOK-028 | M0 | Must | US-173 | – | – | – | Specified |
| REQ-BOOK-029 | M1 | Should | US-196 | – | – | – | Specified |
| REQ-BOOK-030 | M1 | Should | US-215 | – | – | – | Specified |
| REQ-CUST-001 | M1 | Must | US-180 | – | – | – | Specified |
| REQ-CUST-002 | M1 | Must | US-180 | – | – | – | Specified |
| REQ-CUST-003 | M1 | Must | US-181 | – | – | – | Specified |
| REQ-CUST-004 | M1 | Must | US-181 | – | – | – | Specified |
| REQ-CUST-005 | M1 | Should | US-185 | – | – | – | Specified |
| REQ-CUST-006 | M1 | Must | US-182 | – | – | – | Specified |
| REQ-CUST-007 | M1 | Must | US-182 | – | – | – | Specified |
| REQ-CUST-008 | M1 | Should | US-185 | – | – | – | Specified |
| REQ-CUST-009 | M1 | Must | US-183 | – | – | – | Specified |
| REQ-CUST-010 | M1 | Must | US-184 | – | – | – | Specified |
| REQ-CUST-011 | M1 | Must | US-184 | – | – | – | Specified |
| REQ-CUST-012 | M1 | Must | US-186 | – | – | – | Specified |
| REQ-CUST-013 | M1 | Must | US-186 | – | – | – | Specified |
| REQ-CUST-014 | M1 | Should | US-188 | – | – | – | Specified |
| REQ-CUST-015 | M1 | Must | US-187 | – | – | – | Specified |
| REQ-PAY-001 | M0 | Must | US-199 | – | – | – | Specified |
| REQ-PAY-002 | M0 | Must | US-199 | – | – | – | Specified |
| REQ-PAY-003 | M0 | Must | US-200 | – | – | – | Specified |
| REQ-PAY-004 | M1 | Must | US-210 | – | – | – | Specified |
| REQ-PAY-005 | M1 | Must | US-211 | – | – | – | Specified |
| REQ-PAY-006 | M1 | Must | US-209 | – | – | – | Specified |
| REQ-PAY-007 | M1 | Must | US-208 | – | – | – | Specified |
| REQ-PAY-008 | M1 | Must | US-209 | – | – | – | Specified |
| REQ-PAY-009 | M1 | Must | US-212 | – | – | – | Specified |
| REQ-PAY-010 | M1 | Must | US-212 | – | – | – | Specified |
| REQ-PAY-011 | M1 | Must | US-213 | – | – | – | Specified |
| REQ-PAY-012 | M1 | Must | US-213 | – | – | – | Specified |
| REQ-PAY-013 | M1 | Should | US-216 | – | – | – | Specified |
| REQ-PAY-014 | M1 | Should | US-217 | – | – | – | Specified |
| REQ-PAY-015 | M1 | Should | US-218 | – | – | – | Specified |
| REQ-PAY-016 | M1 | Must | US-214 | – | – | – | Specified |
| REQ-PAY-017 | M1 | Must | US-210, US-214 | – | – | – | Specified |
| REQ-PAY-018 | M1 | Should | US-219 | – | – | – | Specified |
| REQ-PAY-019 | M1 | Should | US-211 | – | – | – | Specified |
| REQ-DOC-001 | M1 | Must | US-220 | – | – | – | Specified |
| REQ-DOC-002 | M1 | Must | US-222 | – | – | – | Specified |
| REQ-DOC-003 | M1 | Should | US-230 | – | – | – | Specified |
| REQ-DOC-004 | M1 | Must | US-221 | – | – | – | Specified |
| REQ-DOC-005 | M1 | Must | US-220 | – | – | – | Specified |
| REQ-DOC-006 | M1 | Must | US-220 | – | – | – | Specified |
| REQ-DOC-007 | M1 | Must | US-225 | – | – | – | Specified |
| REQ-DOC-008 | M1 | Must | US-226 | – | – | – | Specified |
| REQ-DOC-009 | M1 | Should | US-227 | – | – | – | Specified |
| REQ-DOC-010 | M1 | Should | US-228 | – | – | – | Specified |
| REQ-DOC-011 | M1 | Must | US-224 | – | – | – | Specified |
| REQ-DOC-012 | M1 | Must | US-223 | – | – | – | Specified |
| REQ-DOC-013 | M1 | Should | US-229 | – | – | – | Specified |
| REQ-DOC-014 | M1 | Should | US-229 | – | – | – | Specified |
| REQ-DOC-015 | M1 | Could | US-231 | – | – | – | Specified |
| REQ-PICK-001 | M1 | Must | US-233, US-234 | – | – | – | Specified |
| REQ-PICK-002 | M1 | Must | US-232, US-234 | – | – | – | Specified |
| REQ-PICK-003 | M1 | Must | US-232 | – | – | – | Specified |
| REQ-PICK-004 | M1 | Must | US-232, US-234 | – | – | – | Specified |
| REQ-PICK-005 | M1 | Must | US-235 | – | – | – | Specified |
| REQ-PICK-006 | M1 | Must | US-235 | – | – | – | Specified |
| REQ-PICK-007 | M1 | Must | US-236 | – | – | – | Specified |
| REQ-PICK-008 | M1 | Must | US-237 | – | – | – | Specified |
| REQ-PICK-009 | M1 | Should | US-238 | – | – | – | Specified |
| REQ-PICK-010 | M1 | Should | US-239 | – | – | – | Specified |
| REQ-PICK-011 | M1 | Could | US-240 | – | – | – | Specified |
| REQ-PICK-012 | M1 | Must | US-233 | – | – | – | Specified |
| REQ-PICK-013 | M1 | Should | US-239 | – | – | – | Specified |
| REQ-PICK-014 | M1 | Could | US-240 | – | – | – | Specified |
| REQ-TRACK-001 | M1 | Must | US-241 | – | – | – | Specified |
| REQ-TRACK-002 | M1 | Must | US-242 | – | – | – | Specified |
| REQ-TRACK-003 | M1 | Must | US-243 | – | – | – | Specified |
| REQ-TRACK-004 | M1 | Must | US-244 | – | – | – | Specified |
| REQ-TRACK-005 | M1 | Must | US-242 | – | – | – | Specified |
| REQ-TRACK-006 | M1 | Should | US-252 | – | – | – | Specified |
| REQ-TRACK-007 | M1 | Should | US-246 | – | – | – | Specified |
| REQ-TRACK-008 | M1 | Must | US-247 | – | – | – | Specified |
| REQ-TRACK-009 | M1 | Should | US-250 | – | – | – | Specified |
| REQ-TRACK-010 | M1 | Must | US-249 | – | – | – | Specified |
| REQ-TRACK-011 | M1 | Must | US-248 | – | – | – | Specified |
| REQ-TRACK-012 | M1 | Must | US-247 | – | – | – | Specified |
| REQ-TRACK-013 | M1 | Must | US-251 | – | – | – | Specified |
| REQ-TRACK-014 | M1 | Must | US-245 | – | – | – | Specified |
| REQ-TRACK-015 | M1 | Could | US-253 | – | – | – | Specified |
| REQ-ACCT-001 | M1 | Should | US-258 | – | – | – | Specified |
| REQ-ACCT-002 | M1 | Must | US-254 | – | – | – | Specified |
| REQ-ACCT-003 | M1 | Must | US-255 | – | – | – | Specified |
| REQ-ACCT-004 | M1 | Must | US-256 | – | – | – | Specified |
| REQ-ACCT-005 | M1 | Should | US-259 | – | – | – | Specified |
| REQ-ACCT-006 | M1 | Should | US-260 | – | – | – | Specified |
| REQ-ACCT-007 | M1 | Should | US-261 | – | – | – | Specified |
| REQ-ACCT-008 | M1 | Should | US-262 | – | – | – | Specified |
| REQ-ACCT-009 | M1 | Should | US-263 | – | – | – | Specified |
| REQ-ACCT-010 | M1 | Could | US-264 | – | – | – | Specified |
| REQ-ACCT-011 | M1 | Should | US-265 | – | – | – | Specified |
| REQ-ACCT-012 | M1 | Should | US-266 | – | – | – | Specified |
| REQ-ACCT-013 | M1 | Should | US-267 | – | – | – | Specified |
| REQ-ACCT-014 | M1 | Should | US-268 | – | – | – | Specified |
| REQ-ACCT-015 | M1 | Should | US-269 | – | – | – | Specified |
| REQ-ACCT-016 | M1 | Could | US-270 | – | – | – | Specified |
| REQ-ACCT-017 | M1 | Could | US-271 | – | – | – | Specified |
| REQ-ACCT-018 | M1 | Should | US-272 | – | – | – | Specified |
| REQ-ACCT-019 | M1 | Should | US-273 | – | – | – | Specified |
| REQ-ACCT-020 | M1 | Must | US-257 | – | – | – | Specified |
| REQ-NOTIF-001 | M1 | Must | US-274 | – | – | – | Specified |
| REQ-NOTIF-002 | M1 | Should | US-275 | – | – | – | Specified |
| REQ-NOTIF-003 | M1 | Must | US-276 | – | – | – | Specified |
| REQ-NOTIF-004 | M1 | Must | US-277 | – | – | – | Specified |
| REQ-NOTIF-005 | M1 | Must | US-279 | – | – | – | Specified |
| REQ-NOTIF-006 | M1 | Must | US-280 | – | – | – | Specified |
| REQ-NOTIF-007 | M1 | Must | US-282 | – | – | – | Specified |
| REQ-NOTIF-008 | M1 | Must | US-283 | – | – | – | Specified |
| REQ-NOTIF-009 | M1 | Should | US-286 | – | – | – | Specified |
| REQ-NOTIF-010 | M1 | Should | US-287 | – | – | – | Specified |
| REQ-NOTIF-011 | M1 | Should | US-288 | – | – | – | Specified |
| REQ-NOTIF-012 | M1 | Should | US-289 | – | – | – | Specified |
| REQ-NOTIF-013 | M1 | Must | US-284 | – | – | – | Specified |
| REQ-NOTIF-014 | M1 | Must | US-278 | – | – | – | Specified |
| REQ-NOTIF-015 | M1 | Must | US-285 | – | – | – | Specified |
| REQ-NOTIF-016 | M1 | Could | US-290 | – | – | – | Specified |
| REQ-NOTIF-017 | M1 | Must | US-281 | – | – | – | Specified |

## Story → Requirement
| Story | Epic | MS | MoSCoW | Size | Linked REQs | DC |
|---|---|---|---|---|---|---|
| US-001 | EPIC-01 | M0 | Must | M | REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003 | DC |
| US-002 | EPIC-01 | M0 | Must | S | REQ-PLAT-004 | DC |
| US-003 | EPIC-01 | M0 | Must | M | REQ-PLAT-005 | DC |
| US-004 | EPIC-01 | M0 | Must | M | REQ-PLAT-006 | DC |
| US-005 | EPIC-01 | M0 | Must | M | REQ-PLAT-007 |  |
| US-006 | EPIC-01 | M0 | Must | S | REQ-PLAT-008 |  |
| US-007 | EPIC-01 | M0 | Must | M | REQ-PLAT-009, REQ-PLAT-010 |  |
| US-008 | EPIC-01 | M0 | Must | M | REQ-PLAT-011, REQ-PLAT-012 |  |
| US-009 | EPIC-01 | M0 | Must | M | REQ-PLAT-013 | DC |
| US-010 | EPIC-01 | M0 | Must | M | REQ-PLAT-014, REQ-PLAT-015 | DC |
| US-011 | EPIC-01 | M0 | Must | M | REQ-PLAT-016, REQ-PLAT-017 | DC |
| US-012 | EPIC-01 | M0 | Must | S | REQ-PLAT-018 | DC |
| US-013 | EPIC-01 | M0 | Should | S | REQ-PLAT-019, REQ-PLAT-022 |  |
| US-014 | EPIC-01 | M0 | Should | M | REQ-PLAT-020, REQ-PLAT-021 |  |
| US-015 | EPIC-02 | M0 | Must | M | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003 | DC |
| US-016 | EPIC-02 | M0 | Must | S | REQ-AUTH-004 | DC |
| US-017 | EPIC-02 | M0 | Must | M | REQ-AUTH-005 | DC |
| US-018 | EPIC-02 | M0 | Must | M | REQ-AUTH-006, REQ-AUTH-007, REQ-AUTH-008 | DC |
| US-019 | EPIC-02 | M0 | Must | M | REQ-AUTH-009 |  |
| US-020 | EPIC-02 | M0 | Must | M | REQ-AUTH-010 | DC |
| US-021 | EPIC-02 | M0 | Must | M | REQ-AUTH-011, REQ-AUTH-012 |  |
| US-022 | EPIC-02 | M0 | Must | M | REQ-AUTH-013, REQ-AUTH-014 |  |
| US-023 | EPIC-02 | M0 | Must | M | REQ-AUTH-015, REQ-AUTH-016 | DC |
| US-024 | EPIC-02 | M0 | Must | M | REQ-AUTH-017 | DC |
| US-025 | EPIC-02 | M0 | Must | S | REQ-AUTH-018 | DC |
| US-026 | EPIC-02 | M1 | Should | M | REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008 |  |
| US-027 | EPIC-02 | M1 | Must | M | REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007 |  |
| US-028 | EPIC-02 | M1 | Should | S | REQ-AUTH-023 |  |
| US-029 | EPIC-02 | M0 | Should | S | REQ-AUTH-024 |  |
| US-030 | EPIC-02 | M0 | Must | S | REQ-ADMIN-001, REQ-ADMIN-003 | DC |
| US-031 | EPIC-02 | M0 | Must | M | REQ-ADMIN-002 | DC |
| US-032 | EPIC-02 | M0 | Must | M | REQ-ADMIN-005, REQ-ADMIN-006, REQ-ADMIN-009 | DC |
| US-033 | EPIC-02 | M0 | Should | S | REQ-ADMIN-004, REQ-ADMIN-010 |  |
| US-034 | EPIC-16 | M0 | Must | M | REQ-API-001, REQ-API-002, REQ-API-004 | DC |
| US-035 | EPIC-16 | M0 | Should | M | REQ-API-003, REQ-API-015, REQ-API-019, REQ-API-020 |  |
| US-036 | EPIC-16 | M0 | Must | M | REQ-API-005, REQ-API-006 |  |
| US-037 | EPIC-16 | M0 | Must | M | REQ-API-007, REQ-API-008 |  |
| US-038 | EPIC-16 | M0 | Must | M | REQ-API-009, REQ-API-010, REQ-API-011 | DC |
| US-039 | EPIC-16 | M0 | Must | M | REQ-API-012, REQ-API-013 |  |
| US-040 | EPIC-16 | M0 | Must | M | REQ-API-014, REQ-SEC-005, REQ-SEC-006 |  |
| US-041 | EPIC-16 | M0 | Must | S | REQ-API-016 |  |
| US-042 | EPIC-16 | M0 | Must | M | REQ-API-017, REQ-API-018 | DC |
| US-043 | EPIC-16 | M0 | Must | M | REQ-SEC-001, REQ-SEC-002, REQ-SEC-003 |  |
| US-044 | EPIC-16 | M0 | Must | M | REQ-SEC-004, REQ-SEC-014 |  |
| US-045 | EPIC-16 | M0 | Must | M | REQ-SEC-007, REQ-SEC-015 |  |
| US-046 | EPIC-16 | M0 | Must | M | REQ-SEC-008, REQ-SEC-009, REQ-SEC-016 |  |
| US-047 | EPIC-16 | M0 | Must | M | REQ-SEC-010, REQ-SEC-012 |  |
| US-048 | EPIC-16 | M0 | Must | M | REQ-SEC-011, REQ-SEC-013 |  |
| US-049 | EPIC-17 | M0 | Must | M | REQ-DATA-001, REQ-DATA-002 | DC |
| US-050 | EPIC-17 | M0 | Must | M | REQ-DATA-003 | DC |
| US-051 | EPIC-17 | M0 | Must | M | REQ-DATA-004, REQ-DATA-005, REQ-DATA-007 | DC |
| US-052 | EPIC-17 | M0 | Must | S | REQ-DATA-006, REQ-DATA-014 | DC |
| US-053 | EPIC-17 | M0 | Must | M | REQ-DATA-016 | DC |
| US-054 | EPIC-17 | M1 | Must | M | REQ-DATA-008, REQ-DATA-009, REQ-DATA-010, REQ-DATA-012, REQ-DATA-013 | DC |
| US-055 | EPIC-17 | M1 | Must | M | REQ-DATA-011 |  |
| US-056 | EPIC-17 | M1 | Must | M | REQ-DATA-015, REQ-DATA-017 | DC |
| US-057 | EPIC-17 | M1 | Must | M | REQ-COMP-001, REQ-COMP-002 |  |
| US-058 | EPIC-17 | M1 | Must | M | REQ-COMP-003, REQ-COMP-008 |  |
| US-059 | EPIC-17 | M1 | Must | M | REQ-COMP-004, REQ-COMP-005, REQ-COMP-006 |  |
| US-060 | EPIC-17 | M1 | Should | S | REQ-COMP-007 |  |
| US-061 | EPIC-03 | M0 | Must | S | REQ-ORG-001 | DC |
| US-062 | EPIC-03 | M0 | Must | M | REQ-ORG-002, REQ-ORG-003, REQ-ORG-004 | DC |
| US-063 | EPIC-03 | M0 | Must | M | REQ-ORG-005 | DC |
| US-064 | EPIC-03 | M0 | Must | M | REQ-RLS-009, REQ-RLS-012, REQ-ORG-007 |  |
| US-065 | EPIC-03 | M0 | Must | S | REQ-RBAC-001, REQ-RBAC-014 | DC |
| US-066 | EPIC-03 | M0 | Must | M | REQ-RBAC-002, REQ-RBAC-003, REQ-RBAC-004 | DC |
| US-067 | EPIC-03 | M0 | Must | M | REQ-RBAC-005 | DC |
| US-068 | EPIC-03 | M0 | Must | M | REQ-RBAC-006, REQ-RBAC-008 | DC |
| US-069 | EPIC-03 | M0 | Must | S | REQ-RBAC-007 |  |
| US-070 | EPIC-03 | M0 | Must | M | REQ-RBAC-009, REQ-RBAC-010 |  |
| US-071 | EPIC-03 | M0 | Must | M | REQ-RBAC-011 | DC |
| US-072 | EPIC-03 | M1 | Must | S | REQ-RBAC-012 |  |
| US-073 | EPIC-03 | M0 | Should | S | REQ-RBAC-013 |  |
| US-074 | EPIC-03 | M0 | Must | M | REQ-RLS-001, REQ-RLS-002, REQ-RLS-005 | DC |
| US-075 | EPIC-03 | M0 | Must | S | REQ-RLS-003, REQ-RLS-004 | DC |
| US-076 | EPIC-03 | M0 | Must | S | REQ-RLS-006 | DC |
| US-077 | EPIC-03 | M0 | Must | M | REQ-RLS-007 |  |
| US-078 | EPIC-03 | M0 | Must | S | REQ-RLS-008 | DC |
| US-079 | EPIC-03 | M0 | Must | M | REQ-RLS-010, REQ-RLS-011 |  |
| US-080 | EPIC-03 | M0 | Must | S | REQ-RLS-013 | DC |
| US-081 | EPIC-03 | M1 | Should | S | REQ-ORG-006 |  |
| US-082 | EPIC-03 | M1 | Should | M | REQ-ORG-008, REQ-ORG-009 |  |
| US-083 | EPIC-03 | M1 | Should | M | REQ-ORG-010 |  |
| US-084 | EPIC-03 | M1 | Should | S | REQ-ORG-011 |  |
| US-085 | EPIC-03 | M1 | Should | M | REQ-ORG-012, REQ-ORG-013, REQ-ORG-014 |  |
| US-086 | EPIC-04 | M0 | Must | M | REQ-AUDIT-001, REQ-AUDIT-006 | DC |
| US-087 | EPIC-04 | M0 | Must | M | REQ-AUDIT-002, REQ-AUDIT-003, REQ-AUDIT-011 | DC |
| US-088 | EPIC-04 | M0 | Must | M | REQ-AUDIT-004, REQ-AUDIT-010 | DC |
| US-089 | EPIC-04 | M0 | Must | S | REQ-AUDIT-005 |  |
| US-090 | EPIC-04 | M0 | Must | S | REQ-AUDIT-007 |  |
| US-091 | EPIC-04 | M0 | Must | M | REQ-AUDIT-008, REQ-AUDIT-009 |  |
| US-092 | EPIC-04 | M0 | Must | M | REQ-AUDIT-012 | DC |
| US-093 | EPIC-04 | M0 | Must | S | REQ-AUDIT-013 |  |
| US-094 | EPIC-04 | M0 | Must | M | REQ-AUDIT-014, REQ-AUDIT-015 | DC |
| US-095 | EPIC-04 | M0 | Must | M | REQ-AUDIT-016, REQ-AUDIT-017 | DC |
| US-096 | EPIC-04 | M0 | Must | M | REQ-AUDIT-024 | DC |
| US-097 | EPIC-04 | M0 | Must | M | REQ-AUDIT-019, REQ-AUDIT-023 | DC |
| US-098 | EPIC-04 | M0 | Must | M | REQ-AUDIT-020, REQ-AUDIT-022 | DC |
| US-099 | EPIC-04 | M1 | Should | S | REQ-AUDIT-021 |  |
| US-100 | EPIC-04 | M0 | Should | S | REQ-AUDIT-025, REQ-AUDIT-018 |  |
| US-101 | EPIC-05 | M0 | Must | S | REQ-UI-001 | DC |
| US-102 | EPIC-05 | M0 | Must | M | REQ-UI-002 |  |
| US-103 | EPIC-05 | M0 | Must | M | REQ-UI-003, REQ-UI-004, REQ-UI-005 |  |
| US-104 | EPIC-05 | M0 | Must | M | REQ-UI-006, REQ-UI-007 |  |
| US-105 | EPIC-05 | M0 | Must | M | REQ-UI-008, REQ-UI-009 |  |
| US-106 | EPIC-05 | M0 | Must | M | REQ-UI-010, REQ-UI-022 |  |
| US-107 | EPIC-05 | M0 | Must | M | REQ-UI-011, REQ-UI-012 | DC |
| US-108 | EPIC-05 | M0 | Must | M | REQ-UI-013 | DC |
| US-109 | EPIC-05 | M1 | Must | M | REQ-UI-014, REQ-UI-015 | DC |
| US-110 | EPIC-05 | M0 | Must | M | REQ-UI-016 | DC |
| US-111 | EPIC-05 | M1 | Should | S | REQ-UI-017, REQ-UI-018 |  |
| US-112 | EPIC-05 | M1 | Must | M | REQ-UI-019 |  |
| US-113 | EPIC-05 | M0 | Must | M | REQ-UI-020, REQ-UI-021 |  |
| US-114 | EPIC-05 | M1 | Should | M | REQ-UI-023 |  |
| US-115 | EPIC-05 | M0 | Must | M | REQ-I18N-001, REQ-I18N-002, REQ-I18N-003, REQ-I18N-013 | DC |
| US-116 | EPIC-05 | M0 | Must | M | REQ-I18N-004, REQ-I18N-011, REQ-I18N-014 | DC |
| US-117 | EPIC-05 | M0 | Must | M | REQ-I18N-006, REQ-I18N-007, REQ-I18N-008 | DC |
| US-118 | EPIC-05 | M1 | Should | S | REQ-I18N-012 |  |
| US-119 | EPIC-05 | M1 | Must | M | REQ-I18N-005 | DC |
| US-120 | EPIC-05 | M0 | Must | M | REQ-I18N-009, REQ-I18N-010 |  |
| US-121 | EPIC-06 | M0 | Must | M | REQ-CARR-001, REQ-CARR-002, REQ-CARR-003 | DC |
| US-122 | EPIC-06 | M0 | Must | M | REQ-CARR-004 | DC |
| US-123 | EPIC-06 | M0 | Must | M | REQ-CARR-005, REQ-CARR-006 |  |
| US-124 | EPIC-06 | M0 | Must | S | REQ-CARR-007 | DC |
| US-125 | EPIC-06 | M0 | Must | M | REQ-CARR-011 |  |
| US-126 | EPIC-06 | M0 | Must | M | REQ-CARR-008 | DC |
| US-127 | EPIC-06 | M1 | Must | S | REQ-CARR-021 | DC |
| US-128 | EPIC-06 | M1 | Must | S | REQ-CARR-015 | DC |
| US-129 | EPIC-06 | M1 | Must | S | REQ-CARR-016 |  |
| US-130 | EPIC-06 | M1 | Must | M | REQ-CARR-017 |  |
| US-131 | EPIC-06 | M1 | Must | M | REQ-CARR-012 | DC |
| US-132 | EPIC-06 | M1 | Must | M | REQ-CARR-013 | DC |
| US-133 | EPIC-06 | M1 | Must | M | REQ-CARR-014 | DC |
| US-134 | EPIC-06 | M1 | Must | S | REQ-CARR-010 |  |
| US-135 | EPIC-06 | M1 | Must | M | REQ-CARR-009 | DC |
| US-136 | EPIC-06 | M1 | Must | S | REQ-CARR-018 |  |
| US-137 | EPIC-06 | M1 | Must | S | REQ-CARR-019, REQ-CARR-020 |  |
| US-138 | EPIC-07 | M0 | Must | M | REQ-PRICE-001, REQ-PRICE-002 | DC |
| US-139 | EPIC-07 | M0 | Must | S | REQ-PRICE-004 | DC |
| US-140 | EPIC-07 | M0 | Must | S | REQ-PRICE-003 | DC |
| US-141 | EPIC-07 | M1 | Must | S | REQ-PRICE-005 |  |
| US-142 | EPIC-07 | M1 | Must | M | REQ-PRICE-006, REQ-PRICE-007 |  |
| US-143 | EPIC-07 | M1 | Must | S | REQ-PRICE-008 |  |
| US-144 | EPIC-07 | M1 | Should | M | REQ-PRICE-009, REQ-PRICE-018 |  |
| US-145 | EPIC-07 | M1 | Should | M | REQ-PRICE-010, REQ-PRICE-011 |  |
| US-146 | EPIC-07 | M1 | Must | S | REQ-PRICE-013 |  |
| US-147 | EPIC-07 | M1 | Must | M | REQ-PRICE-014 |  |
| US-148 | EPIC-07 | M1 | Must | S | REQ-PRICE-015 |  |
| US-149 | EPIC-07 | M1 | Must | M | REQ-PRICE-016 |  |
| US-150 | EPIC-07 | M1 | Must | M | REQ-PRICE-017 | DC |
| US-151 | EPIC-07 | M1 | Must | M | REQ-PRICE-019 |  |
| US-152 | EPIC-07 | M1 | Must | M | REQ-PRICE-020 |  |
| US-153 | EPIC-07 | M1 | Could | S | REQ-PRICE-012, REQ-PRICE-021 |  |
| US-154 | EPIC-08 | M0 | Must | M | REQ-QUOTE-001 | DC |
| US-155 | EPIC-08 | M0 | Must | M | REQ-QUOTE-002 | DC |
| US-156 | EPIC-08 | M0 | Must | M | REQ-QUOTE-003, REQ-QUOTE-004 | DC |
| US-157 | EPIC-08 | M1 | Must | M | REQ-QUOTE-005, REQ-QUOTE-006 |  |
| US-158 | EPIC-08 | M1 | Must | M | REQ-QUOTE-023 | DC |
| US-159 | EPIC-08 | M1 | Must | M | REQ-QUOTE-007, REQ-QUOTE-012 | DC |
| US-160 | EPIC-08 | M1 | Must | M | REQ-QUOTE-008 | DC |
| US-161 | EPIC-08 | M1 | Must | M | REQ-QUOTE-009, REQ-QUOTE-011 | DC |
| US-162 | EPIC-08 | M1 | Should | S | REQ-QUOTE-010 |  |
| US-163 | EPIC-08 | M1 | Should | S | REQ-QUOTE-013 |  |
| US-164 | EPIC-08 | M1 | Should | M | REQ-QUOTE-014 |  |
| US-165 | EPIC-08 | M1 | Should | M | REQ-QUOTE-015 |  |
| US-166 | EPIC-08 | M1 | Must | S | REQ-QUOTE-016 | DC |
| US-167 | EPIC-08 | M1 | Must | M | REQ-QUOTE-017 |  |
| US-168 | EPIC-08 | M1 | Must | S | REQ-QUOTE-018 |  |
| US-169 | EPIC-08 | M1 | Should | M | REQ-QUOTE-019, REQ-QUOTE-022 |  |
| US-170 | EPIC-08 | M1 | Should | M | REQ-QUOTE-020, REQ-QUOTE-021 |  |
| US-171 | EPIC-09 | M1 | Must | M | REQ-BOOK-001 | DC |
| US-172 | EPIC-09 | M1 | Must | M | REQ-BOOK-002 | DC |
| US-173 | EPIC-09 | M0 | Must | S | REQ-BOOK-027, REQ-BOOK-028 | DC |
| US-174 | EPIC-09 | M1 | Must | M | REQ-BOOK-003 | DC |
| US-175 | EPIC-09 | M1 | Must | M | REQ-BOOK-005 | DC |
| US-176 | EPIC-09 | M1 | Must | S | REQ-BOOK-006 |  |
| US-177 | EPIC-09 | M1 | Must | S | REQ-BOOK-008 |  |
| US-178 | EPIC-09 | M1 | Should | S | REQ-BOOK-007 |  |
| US-179 | EPIC-09 | M1 | Should | M | REQ-BOOK-004 |  |
| US-180 | EPIC-09 | M1 | Must | M | REQ-BOOK-009, REQ-CUST-001, REQ-CUST-002 | DC |
| US-181 | EPIC-09 | M1 | Must | M | REQ-CUST-003, REQ-CUST-004 | DC |
| US-182 | EPIC-09 | M1 | Must | S | REQ-CUST-006, REQ-CUST-007 | DC |
| US-183 | EPIC-09 | M1 | Must | M | REQ-CUST-009 |  |
| US-184 | EPIC-09 | M1 | Must | S | REQ-CUST-010, REQ-CUST-011 |  |
| US-185 | EPIC-09 | M1 | Should | S | REQ-CUST-005, REQ-CUST-008 |  |
| US-186 | EPIC-09 | M1 | Must | M | REQ-CUST-012, REQ-CUST-013 | DC |
| US-187 | EPIC-09 | M1 | Must | S | REQ-CUST-015 |  |
| US-188 | EPIC-09 | M1 | Should | S | REQ-CUST-014 |  |
| US-189 | EPIC-09 | M1 | Must | S | REQ-BOOK-010 | DC |
| US-190 | EPIC-09 | M1 | Should | M | REQ-BOOK-011 |  |
| US-191 | EPIC-09 | M1 | Must | M | REQ-BOOK-012 | DC |
| US-192 | EPIC-09 | M1 | Must | S | REQ-BOOK-013 | DC |
| US-193 | EPIC-09 | M1 | Should | S | REQ-BOOK-014 |  |
| US-194 | EPIC-09 | M1 | Should | S | REQ-BOOK-015 |  |
| US-195 | EPIC-09 | M1 | Must | M | REQ-BOOK-017 | DC |
| US-196 | EPIC-09 | M1 | Should | M | REQ-BOOK-029 |  |
| US-197 | EPIC-10 | M0 | Must | M | REQ-BOOK-018 | DC |
| US-198 | EPIC-10 | M0 | Must | S | REQ-BOOK-019 | DC |
| US-199 | EPIC-10 | M0 | Must | M | REQ-PAY-001, REQ-PAY-002 | DC |
| US-200 | EPIC-10 | M0 | Must | S | REQ-PAY-003 | DC |
| US-201 | EPIC-10 | M0 | Must | S | REQ-BOOK-026 | DC |
| US-202 | EPIC-10 | M0 | Must | M | REQ-BOOK-020 | DC |
| US-203 | EPIC-10 | M0 | Must | M | REQ-BOOK-021 | DC |
| US-204 | EPIC-10 | M0 | Must | M | REQ-BOOK-022 |  |
| US-205 | EPIC-10 | M0 | Must | S | REQ-BOOK-023 |  |
| US-206 | EPIC-10 | M1 | Must | S | REQ-BOOK-024 |  |
| US-207 | EPIC-10 | M1 | Must | S | REQ-BOOK-025 | DC |
| US-208 | EPIC-10 | M1 | Must | M | REQ-BOOK-016, REQ-PAY-007 | DC |
| US-209 | EPIC-10 | M1 | Must | M | REQ-PAY-006, REQ-PAY-008 | DC |
| US-210 | EPIC-10 | M1 | Must | M | REQ-PAY-004, REQ-PAY-017 | DC |
| US-211 | EPIC-10 | M1 | Must | S | REQ-PAY-005, REQ-PAY-019 |  |
| US-212 | EPIC-10 | M1 | Must | M | REQ-PAY-009, REQ-PAY-010 | DC |
| US-213 | EPIC-10 | M1 | Must | M | REQ-PAY-011, REQ-PAY-012 | DC |
| US-214 | EPIC-10 | M1 | Must | M | REQ-PAY-016, REQ-PAY-017 | DC |
| US-215 | EPIC-10 | M1 | Should | M | REQ-BOOK-030 |  |
| US-216 | EPIC-10 | M1 | Should | M | REQ-PAY-013 |  |
| US-217 | EPIC-10 | M1 | Should | M | REQ-PAY-014 |  |
| US-218 | EPIC-10 | M1 | Should | S | REQ-PAY-015 |  |
| US-219 | EPIC-10 | M1 | Should | S | REQ-PAY-018 |  |
| US-220 | EPIC-11 | M1 | Must | M | REQ-DOC-001, REQ-DOC-005, REQ-DOC-006 | DC |
| US-221 | EPIC-11 | M1 | Must | S | REQ-DOC-004 |  |
| US-222 | EPIC-11 | M1 | Must | M | REQ-DOC-002 | DC |
| US-223 | EPIC-11 | M1 | Must | M | REQ-DOC-012 | DC |
| US-224 | EPIC-11 | M1 | Must | M | REQ-DOC-011 | DC |
| US-225 | EPIC-11 | M1 | Must | M | REQ-DOC-007 | DC |
| US-226 | EPIC-11 | M1 | Must | S | REQ-DOC-008 |  |
| US-227 | EPIC-11 | M1 | Should | S | REQ-DOC-009 |  |
| US-228 | EPIC-11 | M1 | Should | M | REQ-DOC-010 |  |
| US-229 | EPIC-11 | M1 | Should | M | REQ-DOC-013, REQ-DOC-014 |  |
| US-230 | EPIC-11 | M1 | Should | S | REQ-DOC-003 |  |
| US-231 | EPIC-11 | M1 | Could | S | REQ-DOC-015 |  |
| US-232 | EPIC-12 | M1 | Must | M | REQ-PICK-002, REQ-PICK-003, REQ-PICK-004 | DC |
| US-233 | EPIC-12 | M1 | Must | S | REQ-PICK-001, REQ-PICK-012 | DC |
| US-234 | EPIC-12 | M1 | Must | M | REQ-PICK-001, REQ-PICK-002, REQ-PICK-004 | DC |
| US-235 | EPIC-12 | M1 | Must | M | REQ-PICK-005, REQ-PICK-006 | DC |
| US-236 | EPIC-12 | M1 | Must | S | REQ-PICK-007 |  |
| US-237 | EPIC-12 | M1 | Must | S | REQ-PICK-008 |  |
| US-238 | EPIC-12 | M1 | Should | S | REQ-PICK-009 |  |
| US-239 | EPIC-12 | M1 | Should | M | REQ-PICK-010, REQ-PICK-013 |  |
| US-240 | EPIC-12 | M1 | Could | S | REQ-PICK-011, REQ-PICK-014 |  |
| US-241 | EPIC-13 | M1 | Must | M | REQ-TRACK-001 | DC |
| US-242 | EPIC-13 | M1 | Must | M | REQ-TRACK-002, REQ-TRACK-005 | DC |
| US-243 | EPIC-13 | M1 | Must | M | REQ-TRACK-003 |  |
| US-244 | EPIC-13 | M1 | Must | M | REQ-TRACK-004 |  |
| US-245 | EPIC-13 | M1 | Must | S | REQ-TRACK-014 |  |
| US-246 | EPIC-13 | M1 | Should | S | REQ-TRACK-007 |  |
| US-247 | EPIC-13 | M1 | Must | M | REQ-TRACK-008, REQ-TRACK-012 | DC |
| US-248 | EPIC-13 | M1 | Must | M | REQ-TRACK-011 | DC |
| US-249 | EPIC-13 | M1 | Must | S | REQ-TRACK-010 |  |
| US-250 | EPIC-13 | M1 | Should | S | REQ-TRACK-009 |  |
| US-251 | EPIC-13 | M1 | Must | M | REQ-TRACK-013 | DC |
| US-252 | EPIC-13 | M1 | Should | M | REQ-TRACK-006 |  |
| US-253 | EPIC-13 | M1 | Could | S | REQ-TRACK-015 |  |
| US-254 | EPIC-14 | M1 | Must | M | REQ-ACCT-002 | DC |
| US-255 | EPIC-14 | M1 | Must | M | REQ-ACCT-003 | DC |
| US-256 | EPIC-14 | M1 | Must | M | REQ-ACCT-004 |  |
| US-257 | EPIC-14 | M1 | Must | S | REQ-ACCT-020 |  |
| US-258 | EPIC-14 | M1 | Should | M | REQ-ACCT-001 |  |
| US-259 | EPIC-14 | M1 | Should | S | REQ-ACCT-005 |  |
| US-260 | EPIC-14 | M1 | Should | S | REQ-ACCT-006 |  |
| US-261 | EPIC-14 | M1 | Should | S | REQ-ACCT-007 |  |
| US-262 | EPIC-14 | M1 | Should | M | REQ-ACCT-008 |  |
| US-263 | EPIC-14 | M1 | Should | S | REQ-ACCT-009 |  |
| US-264 | EPIC-14 | M1 | Could | M | REQ-ACCT-010 |  |
| US-265 | EPIC-14 | M1 | Should | S | REQ-ACCT-011 |  |
| US-266 | EPIC-14 | M1 | Should | S | REQ-ACCT-012 |  |
| US-267 | EPIC-14 | M1 | Should | S | REQ-ACCT-013 |  |
| US-268 | EPIC-14 | M1 | Should | M | REQ-ACCT-014 |  |
| US-269 | EPIC-14 | M1 | Should | S | REQ-ACCT-015 |  |
| US-270 | EPIC-14 | M1 | Could | S | REQ-ACCT-016 |  |
| US-271 | EPIC-14 | M1 | Could | S | REQ-ACCT-017 |  |
| US-272 | EPIC-14 | M1 | Should | S | REQ-ACCT-018 |  |
| US-273 | EPIC-14 | M1 | Should | S | REQ-ACCT-019 |  |
| US-274 | EPIC-15 | M1 | Must | S | REQ-NOTIF-001 | DC |
| US-275 | EPIC-15 | M1 | Should | S | REQ-NOTIF-002 |  |
| US-276 | EPIC-15 | M1 | Must | S | REQ-NOTIF-003 | DC |
| US-277 | EPIC-15 | M1 | Must | M | REQ-NOTIF-004 | DC |
| US-278 | EPIC-15 | M1 | Must | M | REQ-NOTIF-014 | DC |
| US-279 | EPIC-15 | M1 | Must | M | REQ-NOTIF-005 | DC |
| US-280 | EPIC-15 | M1 | Must | S | REQ-NOTIF-006 | DC |
| US-281 | EPIC-15 | M1 | Must | S | REQ-NOTIF-017 |  |
| US-282 | EPIC-15 | M1 | Must | M | REQ-NOTIF-007 | DC |
| US-283 | EPIC-15 | M1 | Must | M | REQ-NOTIF-008 | DC |
| US-284 | EPIC-15 | M1 | Must | M | REQ-NOTIF-013 | DC |
| US-285 | EPIC-15 | M1 | Must | S | REQ-NOTIF-015 |  |
| US-286 | EPIC-15 | M1 | Should | M | REQ-NOTIF-009 |  |
| US-287 | EPIC-15 | M1 | Should | S | REQ-NOTIF-010 |  |
| US-288 | EPIC-15 | M1 | Should | S | REQ-NOTIF-011 |  |
| US-289 | EPIC-15 | M1 | Should | M | REQ-NOTIF-012 |  |
| US-290 | EPIC-15 | M1 | Could | S | REQ-NOTIF-016 |  |
| US-291 | EPIC-02 | M1 | Must | M | REQ-AUTH-020, REQ-AUTH-025 |  |
| US-292 | EPIC-02 | M0 | Must | S | REQ-AUTH-026 |  |
| US-293 | EPIC-06 | M1 | Must | M | REQ-CARR-022, REQ-CARR-023 |  |

## NFR traceability
NFR → mechanism/ADR → test rows (all 91 NFR IDs incl. NFR-RES-007 added in v1.3, G1-C4) live in [`docs/03-architecture/nfr-traceability.md`](../03-architecture/nfr-traceability.md), owned by principal-architect (Design column) and qa-lead (Test column).
