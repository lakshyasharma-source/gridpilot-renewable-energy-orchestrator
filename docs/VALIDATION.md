# GridPilot - Recorded Simulation Evidence

Generated: 2026-10-11T13:19:02.794Z. Seed 42; all data, tariffs, assets and actions are synthetic.

Each day contains 96 intervals of 15 minutes. The table reports results from the implemented model; it does not establish real-world performance or global optimality.

| Scenario | Validated cycles | Cash cost INR | Baseline cash cost INR | Served demand % | Pending shifted MWh |
|---|---:|---:|---:|---:|---:|
| balanced | 96 | 1345336.02 | 1421653.28 | 99.91 | 0.00 |
| cloud | 96 | 2042489.70 | 2059913.45 | 99.80 | 1.00 |
| price | 96 | 3478100.28 | 3730998.24 | 99.99 | 0.00 |
| outage | 96 | 1388110.58 | 1425773.72 | 99.97 | 0.00 |
| congestion | 96 | 218257.90 | 213557.33 | 67.30 | 0.00 |
| storm | 96 | 1259625.08 | 1260113.58 | 59.68 | 1.00 |
| windSurge | 96 | 635254.62 | 763204.20 | 100.00 | 0.50 |
| frequency | 96 | 1436917.18 | 1427776.16 | 100.00 | 0.50 |
| maintenance | 96 | 1346422.13 | 1428121.69 | 99.99 | 0.00 |

**Comparison limits:** cash cost does not price the completion of any remaining shifted backlog. Compare service outcomes and outstanding demand, especially under congestion or outages. Reliability is an energy-service ratio in this simplified model, not a grid stability measurement.

Four objectives were also exercised for 24 intervals each. A 32-interval changing-condition replay injects clouds, prices, outages, wind surge, low frequency, weather updates, maintenance and tool rejection. An injected tool failure left an auditable rejected/rolled-back attempt and a validated recovery.

Expanded feature coverage: 3 individual consumers; 2 separately constrained transmission interconnects; 2 source-curtailment intervals; 281 load-shifting intervals; 17 low-frequency support intervals; 24 sampled maintenance decisions. Minimum illustrative battery health: 99.9965%.

Frequency uses a declared dispatch-response proxy; transmission uses individual transport caps. These checks do not establish AC power-flow feasibility or frequency stability. Battery health is a throughput ledger with fixed nameplate capacity.

Total evaluated cycles: 993. Evaluation runtime: 17.45 seconds on the current host. Exact metrics and recovery tools are in VALIDATION_RESULTS.json.

Run `node --test tests/*.test.mjs` for the separate invariant and failure-recovery suite. Run `node tests/evaluate.mjs` to regenerate this evidence from the exact source version.
