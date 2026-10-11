import test from 'node:test';
import assert from 'node:assert/strict';
import { EnergySimulation, SCENARIOS, OBJECTIVES, ASSETS, validateDispatch, DT_HOURS } from '../dist/engine.js';

const EPS = 1e-6;
const near = (a, b, label = 'values') => assert.ok(Math.abs(a - b) < EPS, `${label}: ${a} != ${b}`);
const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
const copy = value => JSON.parse(JSON.stringify(value));

function assertPhysical(record) {
  const d = record.dispatch, o = record.observation;
  near(d.solarMW + d.windMW + d.dischargeMW + d.importMW,
    d.scheduledDemandMW - d.shedMW + d.chargeMW + d.exportMW + d.curtailMW, 'Power balance');
  assert.ok(d.importMW <= o.gridLimitMW + EPS);
  assert.ok(d.exportMW <= o.gridExportLimitMW + EPS);
  assert.ok(d.importMW <= EPS || d.exportMW <= EPS);
  assert.ok(d.chargeMW <= EPS || d.dischargeMW <= EPS);
  near(d.scheduledDemandMW, o.demandMW - d.flexMW + d.restoredMW, 'Load scheduling');
  assert.ok(d.flexMW <= Math.min(2, o.demandMW * 0.1) + EPS);
  assert.ok(d.restoredMW <= 2.5 + EPS);
  assert.ok(d.shedMW >= -EPS && d.shedMW <= d.scheduledDemandMW + EPS);
  const before = record.observation.batteries;
  before.forEach((battery, index) => {
    assert.equal(o.batteryAvailability[battery.id], battery.available, 'Observed availability metadata agrees with per-battery state');
    const action = d.batteryActions[index], after = record.batteries[index];
    assert.equal(action.id, battery.id);
    assert.ok(action.chargeMW >= -EPS && action.chargeMW <= battery.maxMW + EPS);
    assert.ok(action.dischargeMW >= -EPS && action.dischargeMW <= battery.maxMW + EPS);
    assert.ok(action.chargeMW <= EPS || action.dischargeMW <= EPS);
    if (!battery.available) near(action.chargeMW + action.dischargeMW, 0, 'Unavailable asset');
    const floor = Math.min(battery.socMWh, battery.capacityMWh * record.analysis.reserveFraction);
    assert.ok(after.socMWh >= floor - EPS && after.socMWh <= battery.capacityMWh + EPS);
    near(after.socMWh, battery.socMWh + action.chargeMW * DT_HOURS * battery.efficiency - action.dischargeMW * DT_HOURS / battery.efficiency, 'Battery energy');
  });
  near(d.chargeMW, sum(d.batteryActions, action => action.chargeMW));
  near(d.dischargeMW, sum(d.batteryActions, action => action.dischargeMW));
  const pendingBefore = sum(record.audit.backlogBefore, item => item.energyMWh);
  const pendingAfter = sum(record.audit.backlogAfter, item => item.energyMWh);
  near(pendingAfter, pendingBefore + (d.flexMW - d.restoredMW) * DT_HOURS, 'Flexible energy conserved');
  assert.ok(record.audit.backlogAfter.every(item => item.dueTick > record.tick && item.dueTick <= record.tick + 4));
  near(record.metrics.servedMWh + record.metrics.unservedMWh, d.scheduledDemandMW * DT_HOURS);
  near(record.metrics.carbonKg, d.importMW * DT_HOURS * 420);
  near(record.metrics.energyCost, (d.importMW * o.buyPrice - d.exportMW * o.sellPrice) * DT_HOURS);
  near(record.baseline.dispatch.scheduledDemandMW, d.scheduledDemandMW, 'Baseline comparable schedule');
  assert.equal(record.baseline.dispatch.chargeMW, 0);
  assert.equal(record.baseline.dispatch.dischargeMW, 0);
  assert.equal(record.validation.passed, true);
  assert.equal(record.audit.commits, 1);
  assert.equal(record.audit.simulated, true);
  assert.ok(record.execution.every(call => call.args.simulated === true));
  assert.equal(record.execution.filter(call => call.tool === 'transaction.commit' && call.status === 'committed').length, 1);

  // Expanded portfolio checks use independently observed limits and accounting,
  // rather than merely repeating the action generator's own validation result.
  near(d.solarCurtailMW + d.windCurtailMW, d.curtailMW, 'Separate renewable curtailment');
  assert.ok(d.solarCurtailMW >= -EPS && d.solarCurtailMW <= o.solarMW + EPS);
  assert.ok(d.windCurtailMW >= -EPS && d.windCurtailMW <= o.windMW + EPS);
  assert.ok(o.consumers.length >= 3, 'The portfolio needs independently identified industrial consumers');
  near(sum(o.consumers, c => c.demandMW), o.demandMW, 'Observed consumer demand');
  const consumerById = new Map(o.consumers.map(c => [c.id, c]));
  assert.equal(new Set(d.consumerActions.map(a => a.id)).size, o.consumers.length);
  assert.equal(d.consumerActions.length, o.consumers.length);
  for (const action of d.consumerActions) {
    const consumer = consumerById.get(action.id);
    assert.ok(consumer, 'Each load command identifies an observed consumer');
    near(action.demandMW, consumer.demandMW, 'Consumer demand');
    near(action.criticalMW, consumer.criticalMW, 'Critical demand is fixed');
    assert.ok(action.shiftMW >= -EPS && action.shiftMW <= consumer.flexibleMW + EPS);
    near(action.scheduledMW, consumer.demandMW - action.shiftMW + action.restoredMW);
    near(action.servedMW + action.shedMW, action.scheduledMW);
    near(action.criticalShedMW + action.flexibleShedMW, action.shedMW);
    const oldJobs = record.audit.backlogBefore.filter(job => job.consumerId === consumer.id);
    const newJobs = record.audit.backlogAfter.filter(job => job.consumerId === consumer.id);
    near(sum(newJobs, job => job.energyMWh), sum(oldJobs, job => job.energyMWh) +
      (action.shiftMW - action.restoredMW) * DT_HOURS, 'Per-consumer deferred energy');
  }
  near(sum(d.consumerActions, c => c.shiftMW), d.flexMW);
  near(sum(d.consumerActions, c => c.restoredMW), d.restoredMW);
  near(sum(d.consumerActions, c => c.scheduledMW), d.scheduledDemandMW);
  near(sum(d.consumerActions, c => c.shedMW), d.shedMW);
  const criticalShed = sum(d.consumerActions, c => c.criticalShedMW);
  const flexibleServed = sum(d.consumerActions, c => c.scheduledMW - c.criticalMW - c.flexibleShedMW);
  assert.ok(criticalShed <= EPS || flexibleServed <= EPS, 'Critical loads take precedence over flexible service');
  assert.ok(record.audit.backlogAfter.every(job => consumerById.has(job.consumerId)));
  const lineById = new Map(o.gridLines.map(line => [line.id, line]));
  assert.equal(new Set(d.lineFlows.map(flow => flow.id)).size, o.gridLines.length);
  for (const flow of d.lineFlows) {
    const line = lineById.get(flow.id);
    assert.ok(line);
    assert.ok(flow.importMW >= -EPS && flow.importMW <= line.importLimitMW + EPS);
    assert.ok(flow.exportMW >= -EPS && flow.exportMW <= line.exportLimitMW + EPS);
    if (!line.available) near(flow.importMW + flow.exportMW, 0, 'Unavailable line flow');
  }
  near(sum(d.lineFlows, flow => flow.importMW), d.importMW);
  near(sum(d.lineFlows, flow => flow.exportMW), d.exportMW);
  assert.ok(Number.isFinite(d.frequencyAfterHz) && d.frequencyAfterHz >= 49.5 && d.frequencyAfterHz <= 50.5);
  near(d.frequencyAfterHz, Math.max(49.5, Math.min(50.5,
    o.gridFrequencyHz + 0.02 * (d.dischargeMW - d.chargeMW))), 'Documented frequency proxy');
  record.batteries.forEach((battery, index) => {
    assert.ok(battery.healthPercent <= before[index].healthPercent + EPS);
    assert.ok(battery.healthPercent >= 0 && battery.healthPercent <= 100);
    assert.ok(battery.throughputMWh >= before[index].throughputMWh - EPS);
  });
}

test('Every scenario preserves physical invariants across seeded 24-hour runs', () => {
  for (const scenario of SCENARIOS) for (const seed of [1, 42, 7381]) {
    const sim = new EnergySimulation({ seed, scenario: scenario.id });
    for (let tick = 0; tick < 96; tick++) assertPhysical(sim.cycle());
    const total = sim.aggregate();
    near(total.shiftedMWh, total.restoredMWh + total.pendingShiftMWh);
    assert.ok(total.reliabilityPercent >= 0 && total.reliabilityPercent <= 100);
    assert.ok(total.renewableUtilizationPercent >= 0 && total.renewableUtilizationPercent <= 100 + EPS);
  }
});

test('All requested objectives run safely through mixed observed shocks', () => {
  const types = ['cloud', 'wind', 'price', 'demand', 'outage', 'grid', 'toolFailure', 'storm', 'windSurge', 'frequency', 'forecast', 'maintenance'];
  for (const objective of OBJECTIVES) {
    const sim = new EnergySimulation({ objective: objective.id, seed: 90 });
    for (let tick = 0; tick < types.length * 8; tick++) {
      if (tick % 8 === 0) sim.injectEvent(types[Math.floor(tick / 8)]);
      assertPhysical(sim.cycle());
    }
  }
});

test('Simulated tool failure rolls back the whole prepared attempt and commits replacement once', () => {
  const sim = new EnergySimulation();
  const before = sim.snapshot();
  sim.injectEvent('toolFailure');
  const record = sim.cycle();
  const rejectedAt = record.execution.findIndex(call => call.status === 'rejected');
  const rolledBackAt = record.execution.findIndex(call => call.tool === 'transaction.rollback');
  assert.ok(rejectedAt >= 0 && rolledBackAt > rejectedAt);
  assert.ok(record.execution.slice(0, rejectedAt).every(call => call.status === 'rolled_back'));
  assert.ok(record.execution.slice(rolledBackAt + 1).every(call => call.status === 'committed'));
  assert.equal(record.audit.retries, 1);
  assert.equal(record.audit.commits, 1);
  assert.equal(sim.tick, 1);
  assert.equal(sim.history.length, 1);
  assert.match(record.adaptation, /rolled back.*replanned/);
  assert.equal(record.batteries[1].available, false);
  near(record.batteries[1].socMWh, before.batteries[1].socMWh);
  assertPhysical(record);
  const after = sim.snapshot();
  const duplicate = sim._executePrepared({ dispatch: record.dispatch }, record.audit.transactionId, 2);
  assert.equal(duplicate[0].status, 'already_committed');
  assert.deepEqual(sim.snapshot(), after, 'Duplicate acknowledgement must not apply energy or cost twice');
});

test('A failed battery becomes available only after its observed outage expires', () => {
  const sim = new EnergySimulation();
  sim.injectEvent('toolFailure');
  sim.cycle();
  for (let tick = 1; tick < 8; tick++) {
    assert.equal(sim.snapshot().batteries[1].available, false);
    assertPhysical(sim.cycle());
  }
  assert.equal(sim.snapshot().batteries[1].available, true);
});

test('Independent validator rejects corrupted balance, limits, battery commands, and lost flexible energy', () => {
  const sim = new EnergySimulation({ scenario: 'price' });
  const record = sim.cycle();
  const args = { observation: record.observation, batteries: record.observation.batteries,
    dispatch: record.dispatch, nextBatteries: record.batteries,
    backlogBefore: record.audit.backlogBefore, backlogAfter: record.audit.backlogAfter,
    tick: record.tick, reserveFraction: record.analysis.reserveFraction };
  assert.equal(validateDispatch(args).passed, true);
  const mutations = [
    data => { data.dispatch.importMW += 1; },
    data => { data.dispatch.importMW = data.observation.gridLimitMW + 1; },
    data => { data.dispatch.importMW = 1; data.dispatch.exportMW = 1; },
    data => { data.dispatch.chargeMW = NaN; },
    data => { data.nextBatteries[0].socMWh += 0.1; },
    data => { data.batteries[0].available = false; data.dispatch.batteryActions[0].dischargeMW = 1; },
    data => { data.dispatch.batteryActions[0].chargeMW = 1; data.dispatch.batteryActions[0].dischargeMW = 1; },
    data => { data.dispatch.batteryActions.push(copy(data.dispatch.batteryActions[0])); },
    data => { data.dispatch.flexMW = 3; },
    data => { data.backlogAfter.push({ dueTick: record.tick, energyMWh: 0.1 }); },
    data => { data.backlogAfter.push({ dueTick: record.tick + 5, energyMWh: 0.1 }); },
    data => { data.dispatch.solarCurtailMW += 0.1; },
    data => { data.dispatch.windCurtailMW = -0.1; },
    data => { data.dispatch.consumerActions[0].shiftMW = data.observation.consumers[0].flexibleMW + 1; },
    data => { data.dispatch.consumerActions[0].criticalMW -= 0.1; },
    data => { data.dispatch.consumerActions[1].id = data.dispatch.consumerActions[0].id; },
    data => { data.backlogAfter.push({ consumerId: 'unknown-consumer', dueTick: record.tick + 1, energyMWh: 0 }); },
    data => { data.dispatch.lineFlows[0].importMW = data.observation.gridLines[0].importLimitMW + 1; },
    data => { data.dispatch.lineFlows[1].id = data.dispatch.lineFlows[0].id; },
    data => { data.dispatch.frequencyAfterHz += 0.1; },
    data => { data.nextBatteries[0].healthPercent += 0.1; },
    data => { data.nextBatteries[0].throughputMWh += 1; },
    data => { data.dispatch.maintenanceActions.push({ jobId: 'unknown-job', assetId: 'battery-a', action: 'schedule', startTick: record.tick }); },
    data => { data.dispatch.maintenanceActions.push({ jobId: 'inspection-test', assetId: 'unknown-asset', action: 'inspect', startTick: record.tick }); }
  ];
  for (const mutate of mutations) {
    const corrupted = copy(args); mutate(corrupted);
    assert.equal(validateDispatch(corrupted).passed, false);
  }
});

test('A raised storm reserve forbids further depletion when initial SOC is below the new floor', () => {
  const sim = new EnergySimulation({ objective: 'cost' });
  sim.batteries[0].socMWh = 1.4; sim.batteries[1].socMWh = 0.9;
  sim.injectEvent('storm');
  const record = sim.cycle();
  assert.equal(record.analysis.requestedObjective, 'cost');
  assert.equal(record.analysis.effectiveObjective, 'reliability');
  assert.equal(record.plan.objective, 'reliability');
  assert.equal(record.analysis.reserveFraction, 0.35);
  near(record.dispatch.dischargeMW, 0);
  assert.equal(record.validation.passed, true, 'Cannot demand an impossible instantaneous reserve increase');
  assertPhysical(record);
});

test('Insufficient grid and storage capacity produces honest unserved demand and critical warning', () => {
  const sim = new EnergySimulation({ scenario: 'storm' });
  sim.injectEvent('demand'); sim.injectEvent('grid');
  for (let tick = 0; tick < 24; tick++) assertPhysical(sim.cycle());
  const critical = sim.history.find(record => record.dispatch.shedMW > 0.001);
  assert.ok(critical);
  assert.ok(critical.analysis.risks.some(risk => risk.startsWith('CRITICAL:')));
  assert.ok(critical.metrics.unservedMWh > 0);
  assert.ok(sim.aggregate().reliabilityPercent < 100);
  near(critical.metrics.unservedMWh, critical.dispatch.shedMW * 0.25);
});

test('Demand shifting restores all deferred energy or exposes the exact remaining backlog', () => {
  const sim = new EnergySimulation({ scenario: 'price', objective: 'cost' });
  for (let tick = 0; tick < 80; tick++) sim.cycle();
  const totals = sim.aggregate();
  assert.ok(totals.shiftedMWh > 0, 'Price scenario should exercise flexible scheduling');
  near(totals.shiftedMWh, totals.restoredMWh + totals.pendingShiftMWh);
  for (const record of sim.history) {
    const start = sum(record.audit.backlogBefore, item => item.energyMWh);
    const due = sum(record.audit.backlogBefore.filter(item => item.dueTick <= record.tick), item => item.energyMWh);
    assert.ok(record.dispatch.restoredMW * DT_HOURS >= due - EPS);
    near(start + (record.dispatch.flexMW - record.dispatch.restoredMW) * DT_HOURS, record.dispatch.backlogMWh);
  }
});

test('Operating cost baseline receives identical generation, schedule and constraints', () => {
  const sim = new EnergySimulation({ seed: 42, scenario: 'balanced' });
  for (let tick = 0; tick < 96; tick++) sim.cycle();
  assert.ok(sim.aggregate().savings > 0, 'Demonstrated sample saves operating cost, not a universal guarantee');
  for (const record of sim.history) {
    const baseline = record.baseline.dispatch;
    near(baseline.solarMW, record.observation.solarMW);
    near(baseline.windMW, record.observation.windMW);
    near(baseline.scheduledDemandMW, record.dispatch.scheduledDemandMW);
    assert.ok(baseline.importMW <= record.observation.gridLimitMW + EPS);
    near(record.baseline.demandShiftCost, record.metrics.demandShiftCost);
  }
  assert.ok(sim.aggregate().baselineReliabilityPercent <= 100);
  assert.match(sim.aggregate().costComparison, /delivered energy|initial battery/);
});

test('Seed and identical event/configuration sequences produce deterministic results', () => {
  const a = new EnergySimulation({ seed: 700 }), b = new EnergySimulation({ seed: 700 });
  for (let tick = 0; tick < 20; tick++) {
    if (tick === 3) { a.injectEvent('price'); b.injectEvent('price'); }
    if (tick === 9) { a.injectEvent('toolFailure'); b.injectEvent('toolFailure'); }
    if (tick === 12) { a.configure({ objective: 'clean' }); b.configure({ objective: 'clean' }); }
    assert.deepEqual(a.cycle(), b.cycle());
  }
  assert.deepEqual(a.aggregate(), b.aggregate());
  assert.notDeepEqual(new EnergySimulation({ seed: 701 }).snapshot().telemetry, new EnergySimulation({ seed: 700 }).snapshot().telemetry);
});

test('Objective selection changes analysis and candidate scoring, and storm adapts autonomously', () => {
  const cost = new EnergySimulation({ scenario: 'price', objective: 'cost' }).cycle();
  const clean = new EnergySimulation({ scenario: 'price', objective: 'clean' }).cycle();
  assert.equal(cost.plan.objective, 'cost'); assert.equal(clean.plan.objective, 'clean');
  assert.notEqual(cost.plan.score, clean.plan.score);
  assert.notEqual(cost.analysis.reserveFraction, clean.analysis.reserveFraction);
  const sim = new EnergySimulation({ objective: 'clean' });
  sim.injectEvent('storm');
  assert.equal(sim.cycle().plan.objective, 'reliability');
  for (let i = 1; i < 12; i++) sim.cycle();
  assert.equal(sim.cycle().plan.objective, 'clean', 'Requested objective resumes once warning expires');
});

test('Event injection changes observations and configure preserves unspecified settings and physical state', () => {
  const sim = new EnergySimulation({ objective: 'clean' });
  const initial = sim.snapshot();
  sim.injectEvent('cloud'); assert.ok(sim.snapshot().telemetry.solarMW < initial.telemetry.solarMW * 0.3);
  sim.injectEvent('wind'); assert.ok(sim.snapshot().telemetry.windMW < initial.telemetry.windMW * 0.3);
  sim.injectEvent('price'); assert.ok(sim.snapshot().telemetry.buyPrice > initial.telemetry.buyPrice * 2);
  sim.injectEvent('demand'); near(sim.snapshot().telemetry.demandMW, initial.telemetry.demandMW + 6);
  sim.injectEvent('grid'); assert.equal(sim.snapshot().telemetry.gridLimitMW, 2);
  sim.configure({ scenario: 'outage' }); assert.equal(sim.snapshot().objective, 'clean');
  assert.equal(sim.snapshot().batteries[1].available, false);
  near(sim.snapshot().batteries[0].socMWh, initial.batteries[0].socMWh);
  assert.equal(sim.tick, 0);
  sim.configure({ objective: 'cost' }); assert.equal(sim.scenario, 'outage');
});

test('Invalid inputs fail explicitly without partial configuration or event mutation', () => {
  for (const seed of [-1, 1.5, NaN, Infinity, '42', 4294967296]) assert.throws(() => new EnergySimulation({ seed }), /Seed/);
  assert.throws(() => new EnergySimulation({ scenario: 'invalid' }), /Unknown scenario/);
  assert.throws(() => new EnergySimulation({ objective: 'invalid' }), /Unknown objective/);
  const sim = new EnergySimulation();
  const before = sim.snapshot();
  assert.throws(() => sim.configure({ scenario: 'storm', objective: 'invalid' }), /Unknown objective/);
  assert.deepEqual(sim.snapshot(), before);
  assert.throws(() => sim.injectEvent('realGridDispatch'), /Unknown event/);
  assert.deepEqual(sim.snapshot(), before);
});

test('Snapshot and cycle result copies cannot corrupt authoritative simulation state', () => {
  const sim = new EnergySimulation();
  sim.injectEvent('cloud');
  const before = sim.snapshot(), snapshot = sim.snapshot();
  snapshot.batteries[0].socMWh = -100; snapshot.telemetry.demandMW = 999;
  snapshot.events[0].type = 'storm'; snapshot.assets[0].capacityMW = 999;
  assert.deepEqual(sim.snapshot(), before);
  const record = sim.cycle(); record.batteries[0].socMWh = -100; record.metrics.cost = 999;
  assert.notEqual(sim.history[0].metrics.cost, 999);
  assert.ok(sim.batteries[0].socMWh >= 0);
});

test('Audit trace contains every autonomous stage and a bounded eight-step horizon', () => {
  const sim = new EnergySimulation();
  const record = sim.cycle();
  assert.deepEqual(record.stages.map(stage => stage.stage), ['observe', 'analyze', 'plan', 'execute', 'validate', 'adapt']);
  assert.equal(record.forecast.length, 8);
  assert.equal(record.plan.horizonMinutes, 120);
  assert.equal(record.time, '10:00'); assert.equal(sim.snapshot().time, '10:15');
  assert.ok(record.plan.candidateCount > 10 && record.plan.candidateCount < 5000);
  assert.match(record.plan.method, /no global optimality/);
  assert.equal(ASSETS.filter(asset => asset.type === 'solar').length, 5);
  assert.equal(ASSETS.filter(asset => asset.type === 'wind').length, 3);
  near(sum(record.observation.assets.filter(asset => asset.type === 'solar'), asset => asset.outputMW), record.observation.solarMW);
  near(sum(record.observation.assets.filter(asset => asset.type === 'wind'), asset => asset.outputMW), record.observation.windMW);
});

test('Empty aggregates avoid division by zero and declare full service before demand exists', () => {
  const total = new EnergySimulation().aggregate();
  assert.equal(total.cost, 0); assert.equal(total.baselineCost, 0); assert.equal(total.savings, 0);
  assert.equal(total.reliabilityPercent, 100); assert.equal(total.baselineReliabilityPercent, 100);
  assert.equal(total.pendingShiftMWh, 0); assert.equal(total.savingsPercent, null);
});

test('Carbon prices and demand-response incentives are real accounting inputs', () => {
  const sim = new EnergySimulation({ objective: 'cost', scenario: 'cloud' });
  sim.configure({ inputs: { carbonPriceINRPerTonne: 5000, demandResponseIncentiveINRPerMWh: 6000 } });
  let imported = 0, shifted = 0;
  for (let tick = 0; tick < 16; tick++) {
    const record = sim.cycle();
    assertPhysical(record);
    const o = record.observation, m = record.metrics;
    assert.equal(o.carbonPriceINRPerTonne, 5000);
    assert.equal(o.demandResponseIncentiveINRPerMWh, 6000);
    near(m.carbonCost, m.carbonKg / 1000 * 5000, 'Carbon price settlement');
    near(m.incentiveRevenue, m.shiftedMWh * 6000, 'Demand-response incentive settlement');
    near(m.cost, m.energyCost + m.degradationCost + m.demandShiftCost + m.carbonCost + m.sourceCurtailCost - m.incentiveRevenue,
      'Complete operating cash cost');
    imported += m.gridImportMWh; shifted += m.shiftedMWh;
  }
  assert.ok(imported > 0, 'Carbon-cost test exercises an actual grid import');
  assert.ok(shifted > 0, 'Incentive test exercises an actual demand-response action');
});

test('Changing only carbon price or incentive changes autonomous dispatch decisions', () => {
  const run = (scenario, inputs) => {
    const sim = new EnergySimulation({ seed: 42, scenario, objective: 'cost' });
    sim.configure({ inputs });
    for (let tick = 0; tick < 16; tick++) assertPhysical(sim.cycle());
    return sim;
  };
  const lowCarbon = run('cloud', { carbonPriceINRPerTonne: 0 });
  const highCarbon = run('cloud', { carbonPriceINRPerTonne: 20000 });
  const choices = sim => sim.history.map(record => ({ importMW: record.dispatch.importMW,
    dischargeMW: record.dispatch.dischargeMW, shiftMW: record.dispatch.flexMW }));
  assert.notDeepEqual(choices(lowCarbon), choices(highCarbon), 'Carbon price must affect chosen actions, not just a displayed total');
  assert.ok(sum(highCarbon.history, r => r.metrics.carbonCost) > 0);
  const noIncentive = run('balanced', { demandResponseIncentiveINRPerMWh: 0 });
  const highIncentive = run('balanced', { demandResponseIncentiveINRPerMWh: 10000 });
  assert.ok(highIncentive.aggregate().shiftedMWh > noIncentive.aggregate().shiftedMWh,
    'The offered incentive should exercise additional conserved flexible scheduling in this controlled case');
});

test('Named industrial consumers conserve individual deferred energy and protect critical loads', () => {
  const sim = new EnergySimulation({ scenario: 'congestion', objective: 'reliability' });
  sim.injectEvent('cloud'); sim.injectEvent('demand');
  const critical = [];
  for (let tick = 0; tick < 24; tick++) {
    const record = sim.cycle(); assertPhysical(record);
    if (record.dispatch.consumerActions.some(action => action.criticalShedMW > EPS)) critical.push(record);
  }
  assert.ok(critical.length > 0, 'The constrained case must exercise an honest critical service shortfall');
  for (const record of critical) for (const action of record.dispatch.consumerActions) {
    near(action.flexibleShedMW, action.scheduledMW - action.criticalMW,
      'Flexible service exhausted before critical service is curtailed');
  }
  for (const consumer of sim.snapshot().telemetry.consumers) {
    const shifted = sum(sim.history, r => r.dispatch.consumerActions.find(a => a.id === consumer.id).shiftMW * DT_HOURS);
    const restored = sum(sim.history, r => r.dispatch.consumerActions.find(a => a.id === consumer.id).restoredMW * DT_HOURS);
    const pending = sum(sim.backlog.filter(job => job.consumerId === consumer.id), job => job.energyMWh);
    near(shifted, restored + pending, 'Portfolio lifetime per-consumer shift balance');
  }
});

test('Wind surge raises output and surplus is explicitly split into solar and wind curtailment', () => {
  const normal = new EnergySimulation({ seed: 42 });
  const surge = new EnergySimulation({ seed: 42 });
  surge.injectEvent('windSurge');
  assert.ok(surge.snapshot().telemetry.windMW > normal.snapshot().telemetry.windMW);
  surge.configure({ scenario: 'windSurge', objective: 'cost' });
  surge.tick = 8; // Start a controlled noon interval with saturated storage.
  surge.batteries.forEach(battery => { battery.socMWh = battery.capacityMWh; });
  const record = surge.cycle(); assertPhysical(record);
  assert.ok(record.dispatch.curtailMW > EPS, 'Surplus must exceed battery headroom and capped exports');
  assert.ok(record.execution.some(call => call.tool === 'renewable.dispatch' &&
    'solarCurtailMW' in call.args && 'windCurtailMW' in call.args));
});

test('Frequency excursions and constrained lines produce auditable safe proxy responses', () => {
  const sim = new EnergySimulation({ objective: 'cost' });
  sim.injectEvent('frequency'); sim.injectEvent('grid');
  const record = sim.cycle(); assertPhysical(record);
  assert.ok(record.observation.gridFrequencyHz < 49.9);
  assert.equal(record.analysis.effectiveObjective, 'reliability');
  assert.ok(record.dispatch.frequencySupportMW > 0);
  assert.ok(Math.abs(50 - record.dispatch.frequencyAfterHz) < Math.abs(50 - record.observation.gridFrequencyHz));
  assert.ok(record.observation.gridLines.some(line => line.importLimitMW < 10));
  assert.ok(record.validation.checks.some(check => /transmission-line/.test(check.name) && check.passed));
  assert.ok(record.validation.checks.some(check => /Frequency/.test(check.name) && check.passed));
});

test('Weather updates refresh both actual observations and the next planning horizon', () => {
  const sim = new EnergySimulation();
  const before = sim.snapshot().telemetry;
  sim.injectEvent('forecast');
  const record = sim.cycle(); assertPhysical(record);
  assert.notDeepEqual(record.observation.weather, before.weather);
  assert.equal(record.observation.weather.updatedTick, record.tick);
  assert.ok(record.forecast.every(point => point.weather && Number.isFinite(point.weather.cloudCoverPct) &&
    Number.isFinite(point.weather.windSpeedMS)));
  near(record.forecast[0].solarMW, record.observation.solarMW);
  near(record.forecast[0].windMW, record.observation.windMW);
});

test('Battery health is a cumulative throughput ledger with fixed nameplate capacity', () => {
  const sim = new EnergySimulation({ scenario: 'price', objective: 'cost' });
  const start = copy(sim.batteries);
  for (let tick = 0; tick < 32; tick++) assertPhysical(sim.cycle());
  assert.ok(sim.aggregate().batteryThroughputMWh > 0);
  for (const battery of sim.batteries) {
    const initial = start.find(b => b.id === battery.id);
    const throughput = sum(sim.history, record => {
      const command = record.dispatch.batteryActions.find(action => action.id === battery.id);
      return (command.chargeMW + command.dischargeMW) * DT_HOURS;
    });
    near(battery.throughputMWh - initial.throughputMWh, throughput);
    assert.ok(battery.healthPercent < initial.healthPercent);
    assert.equal(battery.capacityMWh, initial.capacityMWh);
    assert.equal(battery.maxMW, initial.maxMW);
  }
});

test('Maintenance decisions create tool receipts, respect outage windows and restore asset availability', () => {
  const sim = new EnergySimulation({ scenario: 'maintenance' });
  const records = [];
  for (let tick = 0; tick < 16; tick++) {
    const record = sim.cycle(); assertPhysical(record); records.push(record);
    for (const action of record.dispatch.maintenanceActions) {
      assert.ok(record.execution.some(call => /^(maintenance|inspection)\./.test(call.tool) &&
        call.status === 'committed' && call.args.jobId === action.jobId), 'Every maintenance decision has a simulated committed tool receipt');
      if (action.action !== 'inspect') for (const point of record.forecast.slice(1)) {
        const job = point.maintenanceSchedule.find(item => item.id === action.jobId);
        assert.equal(job.startTick, action.startTick, 'The selected maintenance window is used by future-horizon planning');
        if (job.status === 'active') {
          const asset = point.assets.find(item => item.id === action.assetId);
          if (asset) { assert.equal(asset.available, false); near(asset.outputMW, 0); }
          else assert.equal(point.batteryAvailability[action.assetId], false);
        }
      }
    }
  }
  const scheduled = records.flatMap(record => record.dispatch.maintenanceActions).find(action => action.action === 'schedule');
  assert.ok(scheduled, 'Normal maintenance case must exercise autonomous scheduling');
  const outage = records.find(record => record.tick === scheduled.startTick);
  assert.ok(outage, 'Scheduled outage is observed in the checked interval');
  const during = [...outage.observation.assets, ...outage.observation.batteries].find(asset => asset.id === scheduled.assetId);
  assert.equal(during.available, false, 'Active maintenance removes its asset from dispatch');
  const restored = records.find(record => record.tick === scheduled.startTick + 4);
  const after = [...restored.observation.assets, ...restored.observation.batteries].find(asset => asset.id === scheduled.assetId);
  assert.equal(after.available, true, 'Asset availability returns at the end of the maintenance window');
});

test('Storm risk delays maintenance and a rejected tool attempt never duplicates maintenance commit', () => {
  const sim = new EnergySimulation({ scenario: 'maintenance' });
  sim.injectEvent('storm'); sim.injectEvent('maintenance'); sim.injectEvent('toolFailure');
  const first = sim.cycle(); assertPhysical(first);
  assert.equal(first.audit.retries, 1);
  const records = [first];
  for (let tick = 1; tick < 8; tick++) { const record = sim.cycle(); assertPhysical(record); records.push(record); }
  assert.ok(records.some(record => record.dispatch.maintenanceActions.some(action => action.action === 'delay')),
    'Storm risk must produce an explicit auditable maintenance delay');
  assert.ok(records.some(record => record.execution.some(call => call.tool === 'inspection.dispatch' && call.status === 'committed')),
    'Storm inspection must produce a simulated committed dispatch receipt');
  for (const record of records) {
    const committed = record.execution.filter(call => /^(maintenance|inspection)\./.test(call.tool) && call.status === 'committed');
    assert.equal(new Set(committed.map(call => `${call.args.jobId}:${call.args.action}`)).size, committed.length,
      'No maintenance action may commit twice inside the same dispatch transaction');
    assert.equal(record.execution.filter(call => call.tool === 'transaction.commit' && call.status === 'committed').length, 1);
    for (const action of record.dispatch.maintenanceActions.filter(action => action.action === 'delay')) {
      for (const point of record.forecast.slice(1)) {
        assert.equal(point.maintenanceSchedule.find(job => job.id === action.jobId).startTick, action.startTick,
          'The replanned horizon reflects a staged maintenance delay before the one authoritative commit');
      }
    }
  }
});

test('A newly rejected battery tool replans the other battery maintenance before committing', () => {
  const sim = new EnergySimulation({ scenario: 'maintenance' });
  assertPhysical(sim.cycle()); // Planned Battery A maintenance starts at tick 2.
  sim.injectEvent('toolFailure');
  const record = sim.cycle(); assertPhysical(record);
  assert.equal(record.tick, 1);
  assert.equal(record.audit.retries, 1);
  const delay = record.dispatch.maintenanceActions.find(action => action.jobId === 'maintenance-scenario');
  assert.ok(delay, 'The replacement transaction must reconsider the impending Battery A service');
  assert.equal(delay.action, 'delay', 'Battery B unavailability must keep Battery A available during the immediate outage');
  assert.ok(delay.startTick > 2);
  const next = record.forecast.find(point => point.tick === 2);
  assert.equal(next.batteryAvailability['battery-a'], true);
  assert.equal(next.batteryAvailability['battery-b'], false);
  const committed = record.execution.filter(call => call.tool === 'maintenance.delay' && call.status === 'committed' && call.args.jobId === delay.jobId);
  assert.equal(committed.length, 1);
  assert.equal(sim.snapshot().maintenanceSchedule.find(job => job.id === delay.jobId).startTick, delay.startTick);
});

test('External input validation rejects invalid changes atomically', () => {
  const sim = new EnergySimulation();
  const before = sim.snapshot();
  for (const inputs of [
    { carbonPriceINRPerTonne: -1 }, { carbonPriceINRPerTonne: 20001 },
    { demandResponseIncentiveINRPerMWh: 10001 }, { gridFrequencyHz: NaN },
    { gridFrequencyHz: 49.4 }, { cloudCoverPct: 101 }, { windSpeedMS: -1 }, { invalid: 1 }
  ]) {
    assert.throws(() => sim.configure({ objective: 'clean', inputs }));
    assert.deepEqual(sim.snapshot(), before, 'Rejected input cannot mutate objective or telemetry');
  }
});
