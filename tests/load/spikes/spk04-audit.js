/**
 * SPK-04 (TASK-018; R-ARCH-04; NFR-AUDIT-005, NFR-PERF-001) audit write A/B load script, run by
 * prisma/tests/spikes/spk04/runner.ts inside the grafana/k6 image (pinned by digest), once per arm (off / on / batched).
 *
 * Workload: constant-arrival-rate at RATE rps for DURATION; op mix create 35 / update 20 / detail 30 / list 10 /
 * login_failed 5 %; org 0 is the HOT tenant with 20 % of all traffic (the R-ARCH-04 single-stream question), the
 * other orgs are uniform. Targets: TARGETS = comma-separated replica base URLs, picked round-robin by iteration.
 * Every request is tagged group:non_carrier, op:<name> and hot:<0|1>. The NFR-PERF-001 thresholds are informational
 * (the runner tolerates exit code 99). handleSummary prints the full JSON summary between markers on stdout.
 */
import exec from 'k6/execution';
import http from 'k6/http';

const RATE = Number(__ENV.RATE || 300);
const DURATION = __ENV.DURATION || '120s';
const TARGETS = (__ENV.TARGETS || 'http://host.docker.internal:4101,http://host.docker.internal:4102').split(',');
const ORGS = Number(__ENV.ORGS || 100);
const TENANT_SHARE = 0.95;
/** 20 % of ALL traffic goes to org 0; login_failed (5 %) is anonymous, so the hot share among tenant ops is 0.2 / 0.95. */
const HOT_SHARE = 0.2 / TENANT_SHARE;

/** [op, weight %, method] */
const MIX = [
  ['create', 35, 'POST'],
  ['update', 20, 'POST'],
  ['detail', 30, 'GET'],
  ['list', 10, 'GET'],
  ['login_failed', 5, 'POST'],
];

const BUDGET = ['p(95)<300', 'p(99)<800'];
const thresholds = {
  http_req_duration: BUDGET,
  http_req_failed: ['rate<0.01'],
  'http_req_duration{hot:1}': BUDGET,
  'http_req_duration{hot:0}': BUDGET,
};
for (const [op] of MIX) thresholds[`http_req_duration{op:${op}}`] = BUDGET;

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
  thresholds,
  tags: { group: 'non_carrier' },
  scenarios: {
    audit_ab: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      // ~50 ms per request at RATE needs RATE / 20 VUs; generous headroom so latency spikes do not drop iterations
      preAllocatedVUs: Math.max(20, Math.ceil(RATE / 5)),
      maxVUs: Math.max(100, RATE * 2),
      gracefulStop: '10s',
    },
  },
};

function pickOp() {
  let roll = Math.random() * 100;
  for (const entry of MIX) {
    if (roll < entry[1]) return entry;
    roll -= entry[1];
  }
  return MIX[0];
}

export default function () {
  const [op, , method] = pickOp();
  const hot = op !== 'login_failed' && Math.random() < HOT_SHARE;
  const org = hot ? 0 : 1 + Math.floor(Math.random() * (ORGS - 1));
  const iteration = exec.scenario.iterationInTest;
  const base = TARGETS[iteration % TARGETS.length];
  const correlationId = `spk04-${String(__VU)}-${String(__ITER)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  http.request(method, `${base}/op/${op}?org=${String(org)}`, null, {
    headers: { 'x-correlation-id': correlationId },
    tags: { group: 'non_carrier', op, hot: hot ? '1' : '0', name: `op_${op}` },
  });
}

export function handleSummary(data) {
  return { stdout: `\n@@SPK04_SUMMARY@@${JSON.stringify(data)}@@END@@\n` };
}
