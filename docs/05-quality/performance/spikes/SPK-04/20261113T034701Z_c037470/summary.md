# SPK-04 audit A/B run (20261113T034701Z, c037470)

Rate 300 rps, warm-up 20 s (discarded), measured 120 s, 2 repetition(s), arms off/on/batched.

| rep | arm | p50 | p95 | p99 | Δp95 vs off | Δp99 vs off | rps | dropped | err | CPU mean | CPU>85% share | audit p95 | hot lock p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rep1 | off | 12.16 | 2001.61 | 2028.28 | – | – | 291.27 | 2.90 % | 5.26 % | 65.43 % | 23.3 % | 0 | 0 |
| rep1 | on | 2012.4 | 3985.81 | 4206.77 | 1984.2 | 2178.49 | 235.22 | 20.23 % | 21.09 % | 75.25 % | 34.4 % | 2040.59 | 602.7 |
| rep1 | batched | 1649.25 | 3686.2 | 4262.82 | 1684.59 | 2234.54 | 255.85 | 13.30 % | 15.47 % | 94.05 % | 84.3 % | 1828.36 | 496.38 |
| rep2 | off | 7.74 | 38.41 | 166.38 | – | – | 299.67 | 0.12 % | 0.00 % | 61.4 % | 16.7 % | 0 | 0 |
| rep2 | on | 48.35 | 1080.86 | 2003.22 | 1042.45 | 1836.84 | 296.55 | 1.14 % | 0.69 % | 72.48 % | 26.7 % | 455.69 | 228.55 |
| rep2 | batched | 17.84 | 255.33 | 584.9 | 216.92 | 418.52 | 299.06 | 0.31 % | 0.00 % | 67.57 % | 10.8 % | 119.45 | 167.63 |

Pooled Δ on − off: p95 1513.32 ms, p99 2007.67 ms. Pooled Δ batched − off: p95 950.76 ms, p99 1326.53 ms (budget 15 / 40 ms).

**Verdict: INCONCLUSIVE** (invalid: rep 1 off: dropped_iterations 2.90 % > 1 %; rep 1 off: host CPU > 85 % in 23.3 % of samples (> 10 %); rep 1 on: dropped_iterations 20.23 % > 1 %; rep 1 on: host CPU > 85 % in 34.4 % of samples (> 10 %); rep 1 batched: dropped_iterations 13.30 % > 1 %; rep 1 batched: host CPU > 85 % in 84.3 % of samples (> 10 %); rep 2 off: host CPU > 85 % in 16.7 % of samples (> 10 %); rep 2 on: dropped_iterations 1.14 % > 1 %; rep 2 on: host CPU > 85 % in 26.7 % of samples (> 10 %); rep 2 batched: host CPU > 85 % in 10.8 % of samples (> 10 %))

Integrity: {"chain":true,"immutability":true,"triggers":true,"forceRls":true,"partitions":true,"vaultRows":173806,"dataModelZeroHashLiteral":false}
