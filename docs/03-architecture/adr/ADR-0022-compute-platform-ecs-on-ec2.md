# ADR-0022: Compute platform — ECS on EC2 (capacity provider) vs plain Auto Scaling Group; Terraform written, validated and policy-checked, not applied

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, platform-architect
- **Related:** brief §3.1/§3.3 ("EC2 (App Hosting) with Docker" → ECS on EC2 default, ASG alternative, decide in an ADR), §10; CLAUDE.md §3 (CLOUD_BUDGET 0, no prod target), §5 (IaC only via pipeline); D-002, D-007 #6; NFR-SCALE-003, NFR-AVAIL-001, NFR-OPS-004; platform.md §4–§6

## Context

Containers must run on EC2 instances in an Auto Scaling Group behind an ALB with autoscaling on CPU, request count and queue depth, with rolling and canary deploys and automatic rollback (CANARY_STEPS, ROLLBACK_TRIGGERS). Two deployables (`api`, `worker`) with different scaling signals; frontends are static. No AWS account or budget exists in this run: Terraform is written, `fmt`/`validate`/Checkov-checked, never planned against a real account or applied.

## Options analysis

| Driver (weight) | ECS on EC2 with capacity provider | Plain ASG + launch template (docker/systemd per instance) |
|---|---|---|
| Progressive delivery with automated rollback (5) | Native: ECS deployment circuit breaker; CodeDeploy blue/green with canary/linear traffic shifting and CloudWatch-alarm rollback | Build your own: instance refresh with weighted target groups, custom health analysis scripts |
| Independent scaling of api vs worker (4) | Two services on one cluster; service autoscaling per metric (ALB request count, CPU, custom queue depth); capacity provider scales the ASG to fit tasks | Two ASGs (double the instances at minimum) or co-located processes with coupled scaling |
| Bin-packing and cost at launch (3) | api + worker tasks share instances; 2–3 small instances suffice | One process type per instance → more instances |
| Operational burden (3) | ECS agent + task definitions; AWS-managed scheduler; no control plane cost | AMI/userdata lifecycle, process supervision, log shipping per instance |
| Secrets/config injection (3) | Task definition `secrets` from Secrets Manager; IAM task roles (least privilege per service) | Instance profile shared by all processes; custom secret fetch |
| Observability (2) | awslogs driver, ADOT sidecar/daemon, Container Insights | CloudWatch agent per instance; custom metrics |
| Lock-in / portability (2) | Images are standard OCI; task definitions are AWS-specific but thin; same images run in Compose | Lowest lock-in |
| Fit with brief (3) | Brief's stated default | Brief's named alternative |
| **Weighted result** | **≈ 4.6 / 5** | ≈ 2.7 / 5 |

## Decision

**ECS on EC2** with an EC2 **capacity provider** (managed scaling + managed termination protection) over an ASG of `t3`/`m7i`-class instances in private subnets (3 AZ). Services: `api` (behind ALB target group, service autoscaling on ALB `RequestCountPerTarget` and CPU), `worker` (no load balancer; autoscaling on CPU and a custom CloudWatch metric `queue_depth_total` published from `/metrics` via ADOT). Task roles per service (api: Secrets Manager read, S3 documents/raw buckets, SES send; worker: + KMS decrypt for envelope keys; neither has RDS/IAM admin). Deployments: `api` via **CodeDeploy blue/green** with a `Linear`/`Canary` config matching CANARY_STEPS (5 → 25 → 50 → 100 %, 10 min bakes) and auto-rollback on CloudWatch alarms (5xx > 2× baseline, p95 > budget, fast-burn SLO, unhealthy targets) — the ROLLBACK_TRIGGERS; `worker` via ECS rolling update with deployment circuit breaker (min healthy 100 %, max 200 %) and SIGTERM drain (ADR-0013). Frontends: static assets in S3 behind CloudFront (WAF attached) — platform-architect's decision (platform.md §4) — with the Nginx images retained for Compose and as a fallback target. Images: published to GHCR by CI (D-005); at M5 the ECS task pulls from GHCR via Secrets Manager registry credentials or a mirror to ECR (platform.md decides). **Terraform** modules + `dev/staging/prod` overlays, remote state S3 (locking per current Terraform guidance), tagging, least-privilege IAM, Checkov in CI; `plan`/`apply` jobs exist but are disabled until `DEPLOY_TARGET_*` and credentials (GitHub OIDC role) are configured; `destroy` never outside ephemeral environments. Terraform itself is BUSL-1.1 (a build tool, not a shipped dependency; HCL kept OpenTofu-compatible — D-ARCH-003).

## Alternatives considered

- **ECS on Fargate.** Simplest operations, but the brief fixes EC2-hosted containers; Fargate remains a one-line task-definition change if the constraint is relaxed.
- **EKS.** Over-engineered for two services; control-plane cost; not in the stack.
- **Plain ASG** — see table.

## Consequences

- Positive: canary + automated rollback is native; two services scale independently; images identical to Compose.
- Negative: ECS concepts (capacity providers, CodeDeploy for ECS) add Terraform surface; nothing can be exercised before an AWS account exists (NFR-SCALE-003/AVAIL-001/OPS-004 DEFERRED/PARTIAL).
- Verification now: `terraform fmt -check`, `validate -backend=false`, Checkov 0 failed (or suppressed with reason); workflow lint. At M5: staging apply from CI, canary drill, rollback drill.

## Amendments after the platform review (2026-11-12, platform.md PD-01..PD-10, verified sources listed there)

1. **Edge (PD-01).** One CloudFront distribution per app (web, admin) with WAF; `/api/*` on the same host routes to the ALB → `api`, keeping `__Host-` cookies host-only and CORS minimal; HTML served by the same Nginx images used locally (parity), hashed `/assets/*` from a versioned S3 bucket via OAC so old chunks keep loading during deploys; the ALB accepts only CloudFront traffic carrying an `X-Origin-Verify` secret header. Staging may use the CloudFront free flat-rate plan.
2. **Images to ECS (PD-02).** `cd.yml` copies the released image **digest** from GHCR (read with `GITHUB_TOKEN`) to ECR via OIDC; ECS pulls by digest. Direct GHCR pulls and the ECR pull-through cache were rejected because both require a long-lived GitHub personal token.
3. **Terraform state (PD-03).** S3 backend with native lockfile (`use_lockfile = true`, Terraform ≥ 1.11); no DynamoDB lock table (deprecated).
4. **Canary mechanics (PD-04).** Neither ECS built-in `CANARY`/`LINEAR` strategies nor CodeDeploy custom configs express unequal steps 5 → 25 → 50 → 100 (CodeDeploy offers one canary step or equal linear increments; ECS built-in offers one canary percentage or linear). The `api` service therefore runs as blue/green ECS services (`api-blue`, `api-green`) behind **ALB weighted target groups**, with the CD pipeline shifting weights 5/25/50/100 with 10-minute bakes and evaluating the ROLLBACK_TRIGGERS as CloudWatch alarms (5xx rate > 2× the stable colour, app-reported non-carrier p95 > budget — ALB latency includes SSE streams and is not used — SLO fast-burn, unhealthy hosts); an EventBridge → Lambda guard resets weights to the stable colour if the runner dies mid-bake. Fallback if this is judged too custom at M5: ECS built-in `CANARY` at 5 % (changes CANARY_STEPS; needs a logged decision by the orchestrator). `worker` and frontends use ECS rolling deployments with the deployment circuit breaker and alarms.
5. **Health checks (PD-05).** ALB target health uses `/health/live` so a database failover does not replace every task; `/health/ready` gates deployments and is scraped for alarms.
6. **Migrations (PD-07).** A separate `shipcube-migrate` image (Prisma CLI + seeds, migrator role) runs as a pre-deploy ECS task; runtime images carry no DDL tooling.
7. **Observability sidecar (PD-06).** ADOT collector per task: traces → X-Ray OTLP endpoint (X-Ray SDK/daemon are in maintenance since 2026-02-25; OTel is the path), `/metrics` → CloudWatch EMF with a restricted metric allow-list for cost.
8. **Local edge (PD-08).** A `edge` reverse proxy in Compose mirrors the CloudFront + ALB routing (TLS with a local certificate so `__Host-`/`Secure` cookies work) and is the scale-out balancer for `--scale api=2`.
9. **Scanners as pinned containers (PD-09).** Trivy, Semgrep, Checkov and Gitleaks run as digest-pinned container images (the `trivy-action` tags were hijacked on 2026-03-19/20, CVE-2026-33634).
10. **CI minutes (PD-10, OI-04 — high-impact, for the orchestrator).** The repository is private; GitHub Free includes ≈ 2 000 Linux minutes/month on 2-vCPU runners while P5 was estimated at ≈ 22 000 min/month. The default first applied here (a self-hosted `heavy` runner on the dev host plus a hosted PR fast lane) **was superseded on 2026-11-12 by the human's decision D-ORCH-001**: hosted PR fast lane, heavy suites run locally by test-runner with evidence committed under `docs/05-quality/`, and a dispatch-only hosted full lane at wave ends and gates — no self-hosted runner, no paid minutes (ADR-0023 amendment A–D; the label switch `HEAVY_RUNNER_LABELS` keeps the self-hosted option available). The A-029 reference host becomes the developer machine for k6 gates; hosted 2-vCPU numbers are reported, not gated.

## Reversibility

Medium (task definitions and CodeDeploy wiring are AWS-specific; images and config are not).
