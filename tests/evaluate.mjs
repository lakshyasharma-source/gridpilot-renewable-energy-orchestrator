import { EnergySimulation, SCENARIOS, OBJECTIVES } from '../dist/engine.js';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const results = [];
const featureCoverage = { consumerCount: 0, lineCount: 0, sourceCurtailmentIntervals: 0,
  consumerShiftIntervals: 0, frequencySupportIntervals: 0, maintenanceActions: [], minimumBatteryHealthPercent: 100 };
function captureFeatures(record) {
  featureCoverage.consumerCount = Math.max(featureCoverage.consumerCount, record.observation.consumers.length);
  featureCoverage.lineCount = Math.max(featureCoverage.lineCount, record.observation.gridLines.length);
  if (record.dispatch.solarCurtailMW + record.dispatch.windCurtailMW > 1e-7) featureCoverage.sourceCurtailmentIntervals++;
  if (record.dispatch.consumerActions.some(action => action.shiftMW > 1e-7)) featureCoverage.consumerShiftIntervals++;
  if (Math.abs(record.observation.gridFrequencyHz - 50) > 0.1 && record.dispatch.frequencySupportMW > 1e-7) featureCoverage.frequencySupportIntervals++;
  for (const action of record.dispatch.maintenanceActions) {
    if (featureCoverage.maintenanceActions.length < 24) featureCoverage.maintenanceActions.push({ tick: record.tick, ...action });
  }
  featureCoverage.minimumBatteryHealthPercent = Math.min(featureCoverage.minimumBatteryHealthPercent, ...record.batteries.map(b => b.healthPercent));
}
const started = performance.now();
for (const scenario of SCENARIOS) {
  const sim = new EnergySimulation({ seed: 42, scenario: scenario.id, objective: 'balanced' });
  const timer = performance.now();
  for (let i = 0; i < 96; i++) {
    const record = sim.cycle();
    if (!record.validation.passed) throw new Error('Unvalidated dispatch: ' + scenario.id + ' tick ' + i);
    captureFeatures(record);
  }
  const metrics = sim.aggregate();
  results.push({ scenario: scenario.id, objective: 'balanced', seed: 42, cycles: 96, elapsedMs: Math.round(performance.now() - timer), validatedCycles: sim.history.filter(r => r.validation.passed).length, metrics });
  console.log(scenario.id + ': 96 validated cycles; pending shift ' + Number(metrics.pendingShiftMWh || 0).toFixed(3) + ' MWh');
}
for (const objective of OBJECTIVES) {
  const sim = new EnergySimulation({ seed: 42, scenario: 'balanced', objective: objective.id });
  for (let i = 0; i < 24; i++) {
    const record = sim.cycle();
    if (!record.validation.passed) throw new Error('Objective validation: ' + objective.id);
    captureFeatures(record);
  }
  results.push({ scenario: 'balanced', objective: objective.id, seed: 42, cycles: 24, validatedCycles: sim.history.length, metrics: sim.aggregate() });
}
const fault = new EnergySimulation({ seed: 42 });
fault.injectEvent('toolFailure');
const recovered = fault.cycle();
captureFeatures(recovered);
if (!recovered.validation.passed || !recovered.execution.some(x => /fail|reject|roll/i.test(x.status + ' ' + x.detail))) throw new Error('Missing auditable fault recovery');
const changing = new EnergySimulation({ seed: 42, objective: 'balanced' });
const eventSequence = ['cloud', 'price', 'outage', 'windSurge', 'frequency', 'forecast', 'maintenance', 'toolFailure'];
const transitions = [];
for (let tick = 0; tick < eventSequence.length * 4; tick++) {
  if (tick % 4 === 0) changing.injectEvent(eventSequence[tick / 4]);
  const record = changing.cycle();
  if (!record.validation.passed) throw new Error('Changing-condition validation at tick ' + tick);
  captureFeatures(record);
  if (tick % 4 === 0) transitions.push({ tick, event: eventSequence[tick / 4], objective: record.analysis.effectiveObjective,
    plan: record.plan.summary, gridFrequencyHz: record.observation.gridFrequencyHz,
    frequencyAfterHz: record.dispatch.frequencyAfterHz, maintenanceActions: record.dispatch.maintenanceActions,
    retries: record.audit.retries, validationChecks: record.validation.checks.length });
}
results.push({ scenario: 'changing conditions', objective: 'balanced', seed: 42, cycles: changing.history.length,
  validatedCycles: changing.history.length, metrics: changing.aggregate(), transitions });
const report = { generatedAt: new Date().toISOString(), syntheticData: true, units: { power: 'MW', energy: 'MWh', currency: 'INR', gridCarbon: '420 kg/MWh' }, note: 'Simplified model results. Cash-cost comparisons exclude completion of remaining shifted load; inspect pendingShiftMWh and service outcomes. Frequency is an illustrative dispatch proxy and line limits are a transport abstraction, not AC power flow. No real-world performance claim.', totalCycles: results.reduce((s, r) => s + r.cycles, 0) + 1, elapsedMs: Math.round(performance.now() - started), featureCoverage, results, faultRecovery: { validated: recovered.validation.passed, execution: recovered.execution, adaptation: recovered.adaptation } };
await writeFile(new URL('../docs/VALIDATION_RESULTS.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
const dayResults = results.filter(r => r.cycles === 96);
const f = v => Number(v || 0).toFixed(2);
const markdown = [
  '# GridPilot - Recorded Simulation Evidence', '',
  'Generated: ' + report.generatedAt + '. Seed 42; all data, tariffs, assets and actions are synthetic.', '',
  'Each day contains 96 intervals of 15 minutes. The table reports results from the implemented model; it does not establish real-world performance or global optimality.', '',
  '| Scenario | Validated cycles | Cash cost INR | Baseline cash cost INR | Served demand % | Pending shifted MWh |',
  '|---|---:|---:|---:|---:|---:|',
  ...dayResults.map(r => '| ' + r.scenario + ' | ' + r.validatedCycles + ' | ' + f(r.metrics.cost) + ' | ' + f(r.metrics.baselineCost) + ' | ' + f(r.metrics.reliabilityPercent) + ' | ' + f(r.metrics.pendingShiftMWh) + ' |'), '',
  '**Comparison limits:** cash cost does not price the completion of any remaining shifted backlog. Compare service outcomes and outstanding demand, especially under congestion or outages. Reliability is an energy-service ratio in this simplified model, not a grid stability measurement.', '',
  'Four objectives were also exercised for 24 intervals each. A 32-interval changing-condition replay injects clouds, prices, outages, wind surge, low frequency, weather updates, maintenance and tool rejection. An injected tool failure left an auditable rejected/rolled-back attempt and a validated recovery.', '',
  'Expanded feature coverage: ' + featureCoverage.consumerCount + ' individual consumers; ' + featureCoverage.lineCount + ' separately constrained transmission interconnects; ' + featureCoverage.sourceCurtailmentIntervals + ' source-curtailment intervals; ' + featureCoverage.consumerShiftIntervals + ' load-shifting intervals; ' + featureCoverage.frequencySupportIntervals + ' low-frequency support intervals; ' + featureCoverage.maintenanceActions.length + ' sampled maintenance decisions. Minimum illustrative battery health: ' + featureCoverage.minimumBatteryHealthPercent.toFixed(4) + '%.', '',
  'Frequency uses a declared dispatch-response proxy; transmission uses individual transport caps. These checks do not establish AC power-flow feasibility or frequency stability. Battery health is a throughput ledger with fixed nameplate capacity.', '',
  'Total evaluated cycles: ' + report.totalCycles + '. Evaluation runtime: ' + f(report.elapsedMs / 1000) + ' seconds on the current host. Exact metrics and recovery tools are in VALIDATION_RESULTS.json.', '',
  'Run `node --test tests/*.test.mjs` for the separate invariant and failure-recovery suite. Run `node tests/evaluate.mjs` to regenerate this evidence from the exact source version.', ''
].join('\n');
await writeFile(new URL('../docs/VALIDATION.md', import.meta.url), markdown);
console.log('Evaluation evidence saved: ' + report.totalCycles + ' cycles in ' + report.elapsedMs + ' ms.');
