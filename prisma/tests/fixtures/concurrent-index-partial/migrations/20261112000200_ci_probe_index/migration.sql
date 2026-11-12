-- migration-kind: expand
-- data-changing: no
-- reversible: yes
--
-- Rule-5 probe, atomicity control: a file whose second statement fails. Shows whether the first statement survives.
CREATE TABLE "public"."ci_partial" ("id" INTEGER NOT NULL);
SELECT 1/0;
