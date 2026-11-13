# SPK-04 audit A/B run (20261113T040201Z, c037470, dirty)

Rate 150 rps, warm-up 20 s (discarded), measured 120 s, 2 repetition(s), arms off/on/batched.

| rep | arm | p50 | p95 | p99 | Δp95 vs off | Δp99 vs off | rps | dropped | err | CPU mean | CPU>85% share | audit p95 | hot lock p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rep1 | off | 7.19 | 12.61 | 24.08 | – | – | 150.01 | 0.00 % | 0.00 % | 44.55 % | 0.0 % | 0 | 0 |
| rep1 | on | 16.81 | 34.68 | 83.43 | 22.07 | 59.35 | 149.97 | 0.02 % | 0.00 % | 52.53 % | 1.7 % | 21.82 | 11.03 |
| rep1 | batched | 21.88 | 2830.67 | 3753.98 | 2818.06 | 3729.9 | 142.62 | 4.92 % | 2.26 % | 68.82 % | 33.6 % | 1315.53 | 537.75 |
| rep2 | off | 7.15 | 30.04 | 192.83 | – | – | 149.76 | 0.17 % | 0.00 % | 45.45 % | 4.2 % | 0 | 0 |
| rep2 | on | 14.97 | 27.71 | 43 | -2.33 | -149.83 | 149.99 | 0.00 % | 0.00 % | 42.25 % | 0.8 % | 15.83 | 5.23 |
| rep2 | batched | 18.05 | 1872.27 | 2958.85 | 1842.23 | 2766.02 | 144.1 | 1.86 % | 0.97 % | 72.7 % | 25.2 % | 549.7 | 475.17 |

Pooled Δ on − off: p95 9.87 ms, p99 -45.24 ms. Pooled Δ batched − off: p95 2330.15 ms, p99 3247.96 ms (budget 15 / 40 ms).

**Verdict: INCONCLUSIVE** (invalid: rep 1 batched: dropped_iterations 4.92 % > 1 %; rep 1 batched: host CPU > 85 % in 33.6 % of samples (> 10 %); rep 2 batched: dropped_iterations 1.86 % > 1 %; rep 2 batched: host CPU > 85 % in 25.2 % of samples (> 10 %))

Integrity: {"chain":true,"immutability":true,"triggers":true,"forceRls":true,"partitions":true,"vaultRows":99365,"dataModelZeroHashLiteral":false}
