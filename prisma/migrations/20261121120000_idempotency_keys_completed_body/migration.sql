-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- A completed idempotency key always carries its sealed response (TASK-040 part 040-B, first pull request; ADR-0014
-- amendments 15 and 16, D-ARCH-204; PR040-SEC-02, CWE-345). From this part on, a completion seals ONE envelope
-- {v, origin, status, headers, body} in response_body, with or without a body, and a replay reads the status, the
-- headers and the body from that envelope only; response_status and response_headers stay as informational copies.
-- The check below says so in the database: a COMPLETED row has response_body (and, by ck_idempotency_keys__body_key,
-- its key id), an IN_PROGRESS row has none. So a row can no longer be turned into a body-less replay of a chosen
-- status and headers by nulling its ciphertext.
--
-- Expand only: one CHECK is added, nothing is dropped. The table has never held a row in any deployment (no
-- composition mounts an idempotent route before part 040-B, D-ARCH-191), so VALIDATE scans an empty table; the
-- NOT VALID + VALIDATE form is kept anyway (rule 6: a CHECK on an existing table), under a short lock_timeout (rule 11,
-- 3 s, the migrator role default, so no RESET is needed).
SET lock_timeout = '3s';

ALTER TABLE "public"."idempotency_keys"
    ADD CONSTRAINT "ck_idempotency_keys__completed_body" CHECK (("status" = 'COMPLETED') = ("response_body" IS NOT NULL)) NOT VALID;

ALTER TABLE "public"."idempotency_keys" VALIDATE CONSTRAINT "ck_idempotency_keys__completed_body";
