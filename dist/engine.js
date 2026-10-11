/**
 * Renewable orchestration sandbox. Every dispatch and market trade is simulated.
 * Units: MW, MWh, INR/MWh, INR and kg CO2. One tick is 15 minutes.
 * The planner searches a bounded discrete action set; it is not a global optimum.
 */
export const DT_HOURS = 0.25;
export const HORIZON_STEPS = 8;
export const SCENARIOS = [
  { id: 'balanced', label: 'Normal operations', description: 'A sunny industrial microgrid with changing demand and tariffs.' },
  { id: 'cloud', label: 'Cloud front', description: 'A sustained solar shortfall tests battery and grid coordination.' },
  { id: 'price', label: 'Price spike', description: 'A high import tariff tests storage arbitrage and flexible demand.' },
  { id: 'outage', label: 'Battery outage', description: 'Battery B is unavailable; the planner must use remaining assets.' },
  { id: 'congestion', label: 'Grid congestion', description: 'A restricted interconnect may leave demand unserved when local supply runs out.' },
  { id: 'storm', label: 'Storm warning', description: 'Low renewable output, forecast uncertainty and grid restrictions prioritize reliability.' },
  { id: 'windSurge', label: 'Wind surge', description: 'A sudden wind increase tests charging, exports and source-specific curtailment.' },
  { id: 'frequency', label: 'Frequency excursion', description: 'An illustrative low-frequency signal prioritizes battery support; this is not an electrical grid model.' },
  { id: 'maintenance', label: 'Maintenance window', description: 'The agent schedules or defers simulated maintenance as supply conditions change.' }
];
export const OBJECTIVES = [
  { id: 'balanced', label: 'Balanced' }, { id: 'cost', label: 'Lowest cost' },
  { id: 'clean', label: 'Clean energy' }, { id: 'reliability', label: 'Reliability' }
];
export const ASSETS = [
  ...[6, 5, 4, 3, 2].map((capacityMW, i) => ({ id: `solar-${i + 1}`, name: `Solar ${i + 1}`, type: 'solar', capacityMW })),
  ...[5, 4, 3].map((capacityMW, i) => ({ id: `wind-${i + 1}`, name: `Wind ${i + 1}`, type: 'wind', capacityMW }))
];
const EPS = 1e-7;
const GRID_CARBON_KG_MWH = 420;
const EVENT_TYPES = new Set(['cloud', 'wind', 'windSurge', 'price', 'demand', 'outage', 'grid', 'toolFailure', 'storm', 'frequency', 'forecast', 'maintenance']);
const CONSUMERS = [
  { id: 'consumer-1', name: 'Steel works', share: 0.45, criticalFraction: 0.88, priority: 1 },
  { id: 'consumer-2', name: 'Cold-storage plant', share: 0.35, criticalFraction: 0.75, priority: 2 },
  { id: 'consumer-3', name: 'Assembly factory', share: 0.20, criticalFraction: 0.70, priority: 3 }
];
const INPUT_LIMITS = { carbonPriceINRPerTonne: [0, 20000], demandResponseIncentiveINRPerMWh: [0, 10000], gridFrequencyHz: [49.5, 50.5], cloudCoverPct: [0, 100], windSpeedMS: [0, 30] };
const COPY = value => JSON.parse(JSON.stringify(value));
const sum = (items, fn = x => x) => items.reduce((total, item) => total + fn(item), 0);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
const timeAt = tick => {
  const minutes = ((10 * 60 + tick * 15) % 1440 + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
const noise = (seed, tick, salt) => {
  let n = (seed ^ Math.imul(tick + 1001, 2654435761) ^ Math.imul(salt + 17, 1597334677)) >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 2246822507) >>> 0; n ^= n >>> 13;
  return (n >>> 0) / 4294967296 - 0.5;
};
const profile = (id, storm = false) => ({
  balanced: { cost: 1, carbon: 4, reserve: 2400, curtail: 2500, shed: 1000000, frequency: 120000, floor: 0.15 },
  cost: { cost: 1, carbon: 0, reserve: 0, curtail: 0, shed: 1000000, frequency: 60000, floor: 0.10 },
  clean: { cost: 0.3, carbon: 24, reserve: 1200, curtail: 8000, shed: 1000000, frequency: 120000, floor: 0.15 },
  reliability: { cost: 0.3, carbon: 2, reserve: 16000, curtail: 1500, shed: 4000000, frequency: 400000, floor: storm ? 0.35 : 0.30 }
}[id]);

/** Independent physical/accounting checks, separate from the action generator. */
export function validateDispatch({ observation, batteries, dispatch, nextBatteries, backlogBefore = [], backlogAfter = [], tick = 0, reserveFraction = 0.10 }) {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const d = dispatch || {};
  const required = ['solarMW', 'windMW', 'chargeMW', 'dischargeMW', 'importMW', 'exportMW', 'curtailMW', 'demandMW', 'flexMW', 'shedMW', 'restoredMW', 'scheduledDemandMW'];
  check('Finite non-negative dispatch', required.every(key => finite(d[key]) && d[key] >= -EPS), 'Every power setpoint is finite and non-negative.');
  if (!checks[0].passed || !observation || !Array.isArray(batteries) || !Array.isArray(nextBatteries) || !Array.isArray(d.batteryActions)
    || batteries.some(b => !b || !finite(b.capacityMWh) || b.capacityMWh <= 0 || !finite(b.socMWh) || b.socMWh < -EPS || b.socMWh > b.capacityMWh + EPS || !finite(b.maxMW) || b.maxMW < 0 || !finite(b.efficiency) || b.efficiency <= 0 || b.efficiency > 1)
    || nextBatteries.some(b => !b) || d.batteryActions.some(a => !a) || !finite(reserveFraction) || reserveFraction < 0 || reserveFraction > 1) {
    check('Complete proposal', false, 'Observation, before/after battery states and per-battery setpoints are required.');
    return { passed: false, checks };
  }
  const supply = d.solarMW + d.windMW + d.dischargeMW + d.importMW;
  const use = d.scheduledDemandMW - d.shedMW + d.chargeMW + d.exportMW + d.curtailMW;
  check('Energy balance', Math.abs(supply - use) <= 1e-6, `Supply ${supply.toFixed(4)} MW = demand, storage, exports and curtailment ${use.toFixed(4)} MW.`);
  check('Observed renewable bounds', Math.abs(d.solarMW - observation.solarMW) < EPS && Math.abs(d.windMW - observation.windMW) < EPS && d.curtailMW <= d.solarMW + d.windMW + EPS, 'Dispatch uses the observed generation; any excess is explicitly curtailed.');
  if (observation.assets) check('Source-specific curtailment', finite(d.solarCurtailMW) && finite(d.windCurtailMW) && d.solarCurtailMW >= -EPS && d.windCurtailMW >= -EPS && d.solarCurtailMW <= d.solarMW + EPS && d.windCurtailMW <= d.windMW + EPS && Math.abs(d.solarCurtailMW + d.windCurtailMW - d.curtailMW) < EPS, 'Solar and wind curtailment are individually bounded and sum to total curtailed power.');
  check('Grid import and export limits', d.importMW <= observation.gridLimitMW + EPS && d.exportMW <= observation.gridExportLimitMW + EPS, `Interconnect caps: import ${observation.gridLimitMW} MW, export ${observation.gridExportLimitMW} MW.`);
  check('No simultaneous buy/sell', d.importMW <= EPS || d.exportMW <= EPS, 'A tick can buy or sell electricity, never both.');
  if (observation.gridLines) {
    const flows = Array.isArray(d.lineFlows) ? d.lineFlows : [];
    const ids = new Set(flows.map(line => line.id));
    check('Individual transmission-line limits', flows.length === observation.gridLines.length && ids.size === flows.length && observation.gridLines.every(line => {
      const flow = flows.find(item => item.id === line.id);
      return flow && finite(flow.importMW) && finite(flow.exportMW) && flow.importMW >= -EPS && flow.exportMW >= -EPS && flow.importMW <= line.importLimitMW + EPS && flow.exportMW <= line.exportLimitMW + EPS && (line.available || flow.importMW + flow.exportMW <= EPS);
    }) && Math.abs(sum(flows, line => line.importMW) - d.importMW) < EPS && Math.abs(sum(flows, line => line.exportMW) - d.exportMW) < EPS, 'Two parallel interconnects obey individual transfer limits; their flows sum to the market trade. This is a transport abstraction, not AC power flow.');
  }
  if (finite(observation.gridFrequencyHz)) check('Frequency proxy accounting', finite(d.frequencyAfterHz) && Math.abs(d.frequencyAfterHz - clamp(observation.gridFrequencyHz + 0.02 * (d.dischargeMW - d.chargeMW), 49.5, 50.5)) < EPS && Math.abs(d.frequencySupportMW - (d.dischargeMW - d.chargeMW)) < EPS, 'The explicitly illustrative frequency-response formula is consistent with battery dispatch; this does not certify grid stability.');
  check('No opposing battery fleet commands', d.chargeMW <= EPS || d.dischargeMW <= EPS, 'The fleet cannot charge and discharge in the same tick.');
  check('Demand accounting', Math.abs(d.demandMW - observation.demandMW) < EPS && Math.abs(d.scheduledDemandMW - (d.demandMW - d.flexMW + d.restoredMW)) < 1e-6 && d.shedMW <= d.scheduledDemandMW + EPS, 'Scheduled demand includes all restored flexible energy; unserved energy is reported separately.');
  const flexCapMW = Math.min(2, observation.demandMW * 0.10);
  check('Flexible demand limits', d.flexMW <= flexCapMW + EPS && d.restoredMW <= 2.5 + EPS, 'At most 10% (2 MW) can move; restoration is capped at 2.5 MW.');
  const backlogStart = sum(backlogBefore, x => x.energyMWh);
  const backlogEnd = sum(backlogAfter, x => x.energyMWh);
  check('Flexible energy conservation', Math.abs(backlogEnd - (backlogStart + (d.flexMW - d.restoredMW) * DT_HOURS)) <= 1e-6, `${backlogStart.toFixed(4)} → ${backlogEnd.toFixed(4)} MWh deferred; shifting never removes energy.`);
  check('Flexible demand deadline', backlogAfter.every(item => item.dueTick > tick && finite(item.energyMWh) && item.energyMWh >= -EPS && item.dueTick <= tick + 4), 'Deferred energy must return within four ticks (one hour).');
  if (observation.consumers) {
    check('Deferred consumer identity', [...backlogBefore, ...backlogAfter].every(job => observation.consumers.some(c => c.id === (job.consumerId || 'consumer-3'))), 'Every deferred obligation belongs to a known industrial consumer.');
    const consumerActions = Array.isArray(d.consumerActions) ? d.consumerActions : [];
    check('Individual consumer accounting', consumerActions.length === observation.consumers.length && new Set(consumerActions.map(c => c.id)).size === consumerActions.length && observation.consumers.every(consumer => {
      const action = consumerActions.find(item => item.id === consumer.id);
      if (!action || !['demandMW', 'criticalMW', 'shiftMW', 'restoredMW', 'scheduledMW', 'shedMW', 'servedMW', 'criticalShedMW', 'flexibleShedMW'].every(key => finite(action[key]) && action[key] >= -EPS)) return false;
      const prior = sum(backlogBefore.filter(j => (j.consumerId || 'consumer-3') === consumer.id), j => j.energyMWh);
      const next = sum(backlogAfter.filter(j => (j.consumerId || 'consumer-3') === consumer.id), j => j.energyMWh);
      return Math.abs(action.demandMW - consumer.demandMW) < EPS && Math.abs(action.criticalMW - consumer.criticalMW) < EPS && action.shiftMW <= consumer.flexibleMW + EPS && Math.abs(action.scheduledMW - (consumer.demandMW - action.shiftMW + action.restoredMW)) < EPS && Math.abs(action.servedMW + action.shedMW - action.scheduledMW) < EPS && Math.abs(action.criticalShedMW + action.flexibleShedMW - action.shedMW) < EPS && action.criticalShedMW <= consumer.criticalMW + EPS && action.flexibleShedMW <= action.scheduledMW - consumer.criticalMW + EPS && Math.abs(next - prior - (action.shiftMW - action.restoredMW) * DT_HOURS) < EPS;
    }) && Math.abs(sum(consumerActions, c => c.shiftMW) - d.flexMW) < EPS && Math.abs(sum(consumerActions, c => c.restoredMW) - d.restoredMW) < EPS && Math.abs(sum(consumerActions, c => c.shedMW) - d.shedMW) < EPS && Math.abs(sum(consumerActions, c => c.scheduledMW) - d.scheduledDemandMW) < EPS, 'Each named consumer retains its own deferred energy and demand accounting.');
    check('Critical-load protection', sum(consumerActions, c => c.criticalShedMW) <= EPS || consumerActions.every(c => Math.abs(c.flexibleShedMW - (c.scheduledMW - c.criticalMW)) < EPS), 'All served flexible demand is exhausted before any critical load is reported unserved.');
  }
  if (observation.maintenanceSchedule) {
    const actions = Array.isArray(d.maintenanceActions) ? d.maintenanceActions : [];
    check('Maintenance action limits', new Set(actions.map(action => action.jobId)).size === actions.length && actions.every(action => {
      const assetKnown = [...(observation.assets || []), ...batteries].some(asset => asset.id === action.assetId);
      if (!assetKnown || !Number.isInteger(action.startTick) || !['schedule', 'delay', 'inspect'].includes(action.action)) return false;
      if (action.action === 'inspect') return action.startTick === tick && typeof action.jobId === 'string' && action.jobId.startsWith('inspection-') && observation.storm;
      const job = observation.maintenanceSchedule.find(item => item.id === action.jobId);
      return job && job.assetId === action.assetId && job.status === 'planned' && (action.action === 'schedule' ? action.startTick === job.startTick : job.flexible && action.startTick > job.startTick && action.startTick <= job.originalStartTick + job.maxDelayTicks);
    }), 'Only known planned jobs may be scheduled or delayed within their permitted window. Storm inspections are simulated and do not move energy.');
  }
  const actionsById = new Map(d.batteryActions.map(action => [action.id, action]));
  const nextById = new Map(nextBatteries.map(battery => [battery.id, battery]));
  check('Exactly one command per battery', actionsById.size === batteries.length && d.batteryActions.length === batteries.length && nextById.size === batteries.length && nextBatteries.length === batteries.length && batteries.every(b => actionsById.has(b.id) && nextById.has(b.id)), 'Every asset has one uniquely identified setpoint and resulting state.');
  let fleetCharge = 0, fleetDischarge = 0;
  for (const battery of batteries) {
    const action = actionsById.get(battery.id);
    const next = nextById.get(battery.id);
    if (!action || !next) { check(`${battery.name} complete`, false, 'Missing asset state or setpoint.'); continue; }
    const valuesOK = finite(action.chargeMW) && finite(action.dischargeMW) && finite(next.socMWh) && action.chargeMW >= -EPS && action.dischargeMW >= -EPS;
    check(`${battery.name} immutable asset specification`, next.capacityMWh === battery.capacityMWh && next.maxMW === battery.maxMW && next.efficiency === battery.efficiency && next.available === battery.available, 'A dispatch cannot change asset capacity, power limits, efficiency or observed availability.');
    check(`${battery.name} setpoint limits`, valuesOK && action.chargeMW <= battery.maxMW + EPS && action.dischargeMW <= battery.maxMW + EPS && (action.chargeMW <= EPS || action.dischargeMW <= EPS), `${battery.maxMW} MW charge/discharge limit; no simultaneous commands.`);
    check(`${battery.name} availability`, battery.available || (action.chargeMW <= EPS && action.dischargeMW <= EPS), battery.available ? 'Asset is available.' : 'Unavailable asset receives a zero command.');
    const floor = Math.min(battery.socMWh, battery.capacityMWh * reserveFraction);
    const expected = battery.socMWh + action.chargeMW * DT_HOURS * battery.efficiency - action.dischargeMW * DT_HOURS / battery.efficiency;
    check(`${battery.name} state of charge`, Math.abs(next.socMWh - expected) < 1e-6 && next.socMWh >= floor - EPS && next.socMWh <= battery.capacityMWh + EPS, `Expected ${expected.toFixed(4)} MWh; reserve floor ${floor.toFixed(4)} MWh, capacity ${battery.capacityMWh} MWh.`);
    if (finite(battery.healthPercent)) {
      const throughput = (action.chargeMW + action.dischargeMW) * DT_HOURS;
      check(`${battery.name} degradation ledger`, finite(next.healthPercent) && Math.abs(next.healthPercent - Math.max(80, battery.healthPercent - throughput / battery.capacityMWh * 0.002)) < EPS && Math.abs(next.throughputMWh - battery.throughputMWh - throughput) < EPS, 'Illustrative health decreases with throughput. Nameplate capacity and power remain fixed in this short demo.');
    }
    fleetCharge += action.chargeMW; fleetDischarge += action.dischargeMW;
  }
  check('Battery aggregate accounting', Math.abs(fleetCharge - d.chargeMW) < EPS && Math.abs(fleetDischarge - d.dischargeMW) < EPS, 'Fleet totals equal the individual battery commands.');
  return { passed: checks.every(item => item.passed), checks };
}

function applyFlex(backlog, tick, reductionMW, earlyRestore, consumers = []) {
  let restoreMWh = 0;
  const restoredByConsumer = {}, shiftedByConsumer = {};
  const restore = (job, amount) => { const id = job.consumerId || 'consumer-3'; restoredByConsumer[id] = (restoredByConsumer[id] || 0) + amount / DT_HOURS; restoreMWh += amount; };
  const left = [];
  for (const job of backlog) {
    if (job.dueTick <= tick) restore(job, job.energyMWh);
    else left.push({ ...job });
  }
  if (earlyRestore) {
    let spaceMWh = Math.max(0, 2.5 * DT_HOURS - restoreMWh);
    for (const job of left) {
      const amount = Math.min(job.energyMWh, spaceMWh);
      restore(job, amount); spaceMWh -= amount; job.energyMWh -= amount;
    }
  }
  const next = left.filter(job => job.energyMWh > EPS);
  if (reductionMW > EPS) {
    if (consumers.length) {
      let remaining = reductionMW;
      for (const consumer of [...consumers].sort((a, b) => b.priority - a.priority)) {
        const amount = Math.min(remaining, consumer.flexibleMW);
        if (amount > EPS) { next.push({ consumerId: consumer.id, energyMWh: amount * DT_HOURS, dueTick: tick + 4 }); shiftedByConsumer[consumer.id] = amount; }
        remaining -= amount;
      }
    } else next.push({ energyMWh: reductionMW * DT_HOURS, dueTick: tick + 4 });
  }
  return { restoredMW: restoreMWh / DT_HOURS, backlog: next, restoredByConsumer, shiftedByConsumer };
}

function distributePower(batteries, desiredMW, reserveFraction) {
  const charging = desiredMW < 0;
  let remaining = Math.abs(desiredMW);
  const limits = batteries.map(b => !b.available ? 0 : charging
    ? Math.min(b.maxMW, (b.capacityMWh - b.socMWh) / (DT_HOURS * b.efficiency))
    : Math.min(b.maxMW, Math.max(0, b.socMWh - b.capacityMWh * reserveFraction) * b.efficiency / DT_HOURS));
  const total = sum(limits);
  remaining = Math.min(remaining, total);
  return batteries.map((b, index) => {
    const assigned = total > EPS ? remaining * limits[index] / total : 0;
    return { id: b.id, chargeMW: charging ? assigned : 0, dischargeMW: charging ? 0 : assigned };
  });
}

function proposal(observation, batteries, backlog, tick, desiredMW, reductionMW, earlyRestore, reserveFraction, curtailSource = 'solar') {
  const flex = applyFlex(backlog, tick, reductionMW, earlyRestore, observation.consumers);
  const actions = distributePower(batteries, desiredMW, reserveFraction);
  const chargeMW = sum(actions, a => a.chargeMW), dischargeMW = sum(actions, a => a.dischargeMW);
  const scheduledDemandMW = observation.demandMW - reductionMW + flex.restoredMW;
  const net = scheduledDemandMW + chargeMW - observation.solarMW - observation.windMW - dischargeMW;
  const importMW = Math.min(Math.max(0, net), observation.gridLimitMW);
  const exportMW = Math.min(Math.max(0, -net), observation.gridExportLimitMW);
  // Grid congestion cancels avoidable charging before any demand is shed.
  if (net > observation.gridLimitMW + EPS && chargeMW > EPS) {
    const safeCharge = Math.max(0, chargeMW - (net - observation.gridLimitMW));
    return proposal(observation, batteries, backlog, tick, -safeCharge, reductionMW, earlyRestore, reserveFraction, curtailSource);
  }
  const shedMW = Math.max(0, net - importMW);
  const curtailMW = Math.max(0, -net - exportMW);
  const solarCurtailMW = curtailSource === 'solar' ? Math.min(curtailMW, observation.solarMW) : Math.max(0, curtailMW - observation.windMW);
  const windCurtailMW = curtailMW - solarCurtailMW;
  const consumerActions = (observation.consumers || []).map(consumer => ({ id: consumer.id, name: consumer.name, priority: consumer.priority, demandMW: consumer.demandMW, criticalMW: consumer.criticalMW,
    shiftMW: flex.shiftedByConsumer[consumer.id] || 0, restoredMW: flex.restoredByConsumer[consumer.id] || 0,
    scheduledMW: consumer.demandMW - (flex.shiftedByConsumer[consumer.id] || 0) + (flex.restoredByConsumer[consumer.id] || 0), shedMW: 0, criticalShedMW: 0, flexibleShedMW: 0, servedMW: 0 }));
  let unserved = shedMW;
  for (const action of [...consumerActions].sort((a, b) => b.priority - a.priority)) { const amount = Math.min(unserved, Math.max(0, action.scheduledMW - action.criticalMW)); action.flexibleShedMW = amount; unserved -= amount; }
  for (const action of [...consumerActions].sort((a, b) => b.priority - a.priority)) { const amount = Math.min(unserved, action.criticalMW); action.criticalShedMW = amount; unserved -= amount; }
  for (const action of consumerActions) { action.shedMW = action.criticalShedMW + action.flexibleShedMW; action.servedMW = action.scheduledMW - action.shedMW; }
  const lineFlows = (observation.gridLines || []).map(line => ({ id: line.id, name: line.name, importMW: observation.gridLimitMW > EPS ? importMW * line.importLimitMW / observation.gridLimitMW : 0, exportMW: observation.gridExportLimitMW > EPS ? exportMW * line.exportLimitMW / observation.gridExportLimitMW : 0 }));
  const dispatch = {
    solarMW: observation.solarMW, windMW: observation.windMW,
    chargeMW, dischargeMW, importMW, exportMW, curtailMW, solarCurtailMW, windCurtailMW, curtailSource, consumerActions, lineFlows,
    frequencySupportMW: dischargeMW - chargeMW,
    frequencyAfterHz: clamp((observation.gridFrequencyHz ?? 50) + 0.02 * (dischargeMW - chargeMW), 49.5, 50.5),
    demandMW: observation.demandMW, scheduledDemandMW,
    flexMW: reductionMW, restoredMW: flex.restoredMW, shedMW,
    backlogMWh: sum(flex.backlog, x => x.energyMWh), batteryActions: actions
  };
  const nextBatteries = batteries.map((b, i) => ({ ...b,
    socMWh: clamp(b.socMWh + actions[i].chargeMW * DT_HOURS * b.efficiency - actions[i].dischargeMW * DT_HOURS / b.efficiency, 0, b.capacityMWh),
    healthPercent: Math.max(80, (b.healthPercent ?? 100) - (actions[i].chargeMW + actions[i].dischargeMW) * DT_HOURS / b.capacityMWh * 0.002),
    throughputMWh: (b.throughputMWh || 0) + (actions[i].chargeMW + actions[i].dischargeMW) * DT_HOURS
  }));
  return { dispatch, batteries: nextBatteries, backlog: flex.backlog, metrics: metricsFor(dispatch, observation) };
}

function metricsFor(d, o) {
  const energyCost = (d.importMW * o.buyPrice - d.exportMW * o.sellPrice) * DT_HOURS;
  const batteryThroughputMWh = (d.chargeMW + d.dischargeMW) * DT_HOURS;
  const degradationCost = batteryThroughputMWh * 150;
  const demandShiftCost = d.flexMW * DT_HOURS * 250;
  const carbonKg = d.importMW * DT_HOURS * GRID_CARBON_KG_MWH;
  const carbonCost = carbonKg / 1000 * (o.carbonPriceINRPerTonne || 0);
  const incentiveRevenue = d.flexMW * DT_HOURS * (o.demandResponseIncentiveINRPerMWh || 0);
  const sourceCurtailCost = ((d.solarCurtailMW || 0) * (o.solarCurtailPenaltyINRPerMWh || 0) + (d.windCurtailMW || 0) * (o.windCurtailPenaltyINRPerMWh || 0)) * DT_HOURS;
  return {
    cost: energyCost + degradationCost + demandShiftCost + carbonCost + sourceCurtailCost - incentiveRevenue,
    energyCost, degradationCost, demandShiftCost, carbonCost, incentiveRevenue, sourceCurtailCost, frequencyDeviationHz: Math.abs(d.frequencyAfterHz - 50),
    carbonKg,
    renewableUsedMWh: (d.solarMW + d.windMW - d.curtailMW) * DT_HOURS,
    renewableAvailableMWh: (d.solarMW + d.windMW) * DT_HOURS,
    servedMWh: (d.scheduledDemandMW - d.shedMW) * DT_HOURS,
    unservedMWh: d.shedMW * DT_HOURS, curtailmentMWh: d.curtailMW * DT_HOURS,
    batteryThroughputMWh, gridImportMWh: d.importMW * DT_HOURS,
    gridExportMWh: d.exportMW * DT_HOURS, shiftedMWh: d.flexMW * DT_HOURS,
    restoredMWh: d.restoredMW * DT_HOURS, backlogMWh: d.backlogMWh,
    criticalUnservedMWh: sum(d.consumerActions || [], c => c.criticalShedMW) * DT_HOURS,
    solarCurtailmentMWh: (d.solarCurtailMW || 0) * DT_HOURS, windCurtailmentMWh: (d.windCurtailMW || 0) * DT_HOURS
  };
}

function scoreComponentsFor(p, weights) {
  const reserveGap = sum(p.batteries, b => b.available ? Math.max(0, b.capacityMWh * Math.max(0.45, weights.floor) - b.socMWh) : 0);
  return {
    operatingCostScore: p.metrics.cost * weights.cost,
    carbonScore: p.metrics.carbonKg * weights.carbon,
    unservedScore: p.metrics.unservedMWh * weights.shed,
    reserveGapScore: reserveGap * weights.reserve * DT_HOURS,
    curtailmentScore: p.metrics.curtailmentMWh * weights.curtail,
    frequencyScore: Math.max(0, p.metrics.frequencyDeviationHz - 0.08) * weights.frequency * DT_HOURS
  };
}

function stepScore(p, weights) {
  return sum(Object.values(scoreComponentsFor(p, weights)));
}

function candidatesFor(observation, batteries, backlog, tick, weights) {
  const maxCharge = sum(batteries, b => b.available ? Math.min(b.maxMW, (b.capacityMWh - b.socMWh) / (DT_HOURS * b.efficiency)) : 0);
  const maxDischarge = sum(batteries, b => b.available ? Math.min(b.maxMW, Math.max(0, b.socMWh - weights.floor * b.capacityMWh) * b.efficiency / DT_HOURS) : 0);
  const gap = observation.demandMW - observation.solarMW - observation.windMW;
  const frequencyTarget = ((50 - (observation.gridFrequencyHz ?? 50)) / 0.02);
  const targets = [...new Set([-maxCharge, -maxCharge * 0.5, Math.min(0, gap), 0, maxDischarge * 0.5, maxDischarge, Math.max(0, gap), frequencyTarget].map(x => round(clamp(x, -maxCharge, maxDischarge), 5)))];
  const dueNow = backlog.some(job => job.dueTick <= tick);
  const cap = Math.min(2, observation.demandMW * 0.1, observation.consumers ? sum(observation.consumers, c => c.flexibleMW) : Infinity);
  const flexVariants = [{ reduction: 0, early: false }];
  if (!dueNow && sum(backlog, j => j.energyMWh) < 1.5 - EPS) flexVariants.push({ reduction: Math.min(cap, (1.5 - sum(backlog, j => j.energyMWh)) / DT_HOURS), early: false });
  if (backlog.some(job => job.dueTick > tick)) flexVariants.push({ reduction: 0, early: true });
  const unique = new Map();
  for (const power of targets) for (const flex of flexVariants) for (const source of ['solar', 'wind']) {
    const p = proposal(observation, batteries, backlog, tick, power, flex.reduction, flex.early, weights.floor, source);
    const key = [p.dispatch.chargeMW, p.dispatch.dischargeMW, p.dispatch.flexMW, p.dispatch.restoredMW, p.dispatch.solarCurtailMW].map(x => x.toFixed(5)).join('/');
    unique.set(key, p);
  }
  return [...unique.values()];
}

function planHorizon(forecast, batteries, backlog, tick, objective, storm) {
  const weights = { ...profile(objective, storm) };
  if (!storm) {
    const uncertaintyHeadroom = Math.max(0, forecast[0].uncertaintyPct - 0.08);
    weights.floor = Math.min(0.40, weights.floor + uncertaintyHeadroom * 0.20);
    weights.reserve *= 1 + uncertaintyHeadroom;
  }
  const initial = { batteries: COPY(batteries), backlog: COPY(backlog), score: 0, cost: 0, first: null };
  let beam = [initial], candidateCount = 0;
  const BEAM_WIDTH = 12;
  let finalists = [];
  for (let horizon = 0; horizon < forecast.length; horizon++) {
    const branches = [];
    for (const node of beam) {
      const availableBatteries = horizon === 0 ? node.batteries : node.batteries.map(b => ({ ...b, available: forecast[horizon].batteryAvailability?.[b.id] ?? b.available }));
      for (const p of candidatesFor(forecast[horizon], availableBatteries, node.backlog, tick + horizon, weights)) {
        candidateCount++;
        const first = node.first || p;
        const score = node.score + stepScore(p, weights);
        const stored = sum(p.batteries, b => b.available ? b.socMWh * b.efficiency : 0);
        const terminalValuePerMWh = forecast[horizon].buyPrice * weights.cost * 0.60 + GRID_CARBON_KG_MWH * weights.carbon * 0.35;
        // Inventory has future value; outstanding flexible energy has a future cost.
        const rank = score - stored * terminalValuePerMWh + sum(p.backlog, job => job.energyMWh) * (forecast[horizon].buyPrice * weights.cost + GRID_CARBON_KG_MWH * weights.carbon);
        branches.push({ batteries: p.batteries, backlog: p.backlog, score, rank, cost: node.cost + p.metrics.cost, first });
      }
    }
    branches.sort((a, b) => a.rank - b.rank || a.cost - b.cost);
    const unique = new Map();
    for (const node of branches) {
      const key = `${node.batteries.map(b => b.socMWh.toFixed(2)).join('/')}:${node.backlog.map(j => `${j.dueTick}:${j.energyMWh.toFixed(2)}`).join('/')}`;
      if (!unique.has(key)) unique.set(key, node);
      if (unique.size >= BEAM_WIDTH) break;
    }
    beam = [...unique.values()];
    finalists = beam;
  }
  const best = finalists[0];
  return {
    proposal: best.first, score: best.rank, candidateCount, weights,
    alternatives: finalists.filter((node, index, arr) => arr.findIndex(other => Math.abs(other.first.dispatch.chargeMW - node.first.dispatch.chargeMW) < EPS && Math.abs(other.first.dispatch.dischargeMW - node.first.dispatch.dischargeMW) < EPS && Math.abs(other.first.dispatch.flexMW - node.first.dispatch.flexMW) < EPS) === index).slice(0, 4).map((node, index) => ({
      label: index === 0 ? 'Selected feasible plan' : `Feasible alternative ${index}`,
      score: round(node.rank, 2), cost: round(node.cost, 2),
      chargeMW: node.first.dispatch.chargeMW, dischargeMW: node.first.dispatch.dischargeMW
    }))
  };
}

export class EnergySimulation {
  constructor({ seed = 42, scenario = 'balanced', objective = 'balanced', inputs } = {}) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new TypeError('Seed must be an integer from 0 to 4294967295.');
    this.seed = seed; this.tick = 0; this.history = []; this.events = [];
    this.backlog = []; this.unavailableUntil = new Map(); this.pendingToolFailure = false;
    this.inputOverrides = {}; this.inspections = [];
    this.maintenance = [
      { id: 'maintenance-solar', name: 'Solar 5 inverter service', assetId: 'solar-5', startTick: 6, durationTicks: 4, originalStartTick: 6, maxDelayTicks: 8, flexible: true },
      { id: 'maintenance-wind', name: 'Wind 3 bearing inspection', assetId: 'wind-3', startTick: 36, durationTicks: 4, originalStartTick: 36, maxDelayTicks: 8, flexible: true },
      { id: 'maintenance-battery', name: 'Battery A cooling service', assetId: 'battery-a', startTick: 60, durationTicks: 4, originalStartTick: 60, maxDelayTicks: 8, flexible: true }
    ];
    this.committedTransactions = new Set();
    this.batteries = [
      { id: 'battery-a', name: 'Battery A', capacityMWh: 12, socMWh: 7.2, maxMW: 8, efficiency: 0.92, available: true, healthPercent: 100, throughputMWh: 0 },
      { id: 'battery-b', name: 'Battery B', capacityMWh: 8, socMWh: 4.8, maxMW: 5, efficiency: 0.92, available: true, healthPercent: 100, throughputMWh: 0 }
    ];
    this.initialStoredMWh = sum(this.batteries, b => b.socMWh);
    this.assets = COPY(ASSETS);
    this.configure({ scenario, objective, inputs });
  }

  configure({ scenario, objective, inputs } = {}) {
    if (scenario !== undefined && !SCENARIOS.some(s => s.id === scenario)) throw new TypeError(`Unknown scenario: ${scenario}`);
    if (objective !== undefined && !OBJECTIVES.some(o => o.id === objective)) throw new TypeError(`Unknown objective: ${objective}`);
    if (inputs !== undefined) {
      if (inputs !== null && (typeof inputs !== 'object' || Array.isArray(inputs))) throw new TypeError('Inputs must be an object or null.');
      for (const [key, value] of Object.entries(inputs || {})) {
        const range = INPUT_LIMITS[key];
        if (!range || !finite(value) || value < range[0] || value > range[1]) throw new TypeError(`Invalid simulated input: ${key}`);
      }
      this.inputOverrides = inputs === null ? {} : { ...this.inputOverrides, ...inputs };
    }
    if (scenario !== undefined) this.scenario = scenario;
    if (scenario === 'maintenance' && !this.maintenance.some(job => job.id === 'maintenance-scenario')) this.maintenance.push({ id: 'maintenance-scenario', name: 'Battery A planned service', assetId: 'battery-a', startTick: this.tick + 2, originalStartTick: this.tick + 2, durationTicks: 4, maxDelayTicks: 8, flexible: true });
    if (objective !== undefined) this.objective = objective;
    return this.snapshot();
  }

  injectEvent(type) {
    if (!EVENT_TYPES.has(type)) throw new TypeError(`Unknown event: ${type}`);
    const duration = type === 'storm' ? 12 : 8;
    const labels = { cloud: 'Cloud front: solar forecast reduced', wind: 'Wind lull: output reduced', windSurge: 'Wind surge: renewable surplus increased', price: 'Market import price spike', demand: 'Industrial demand surge', outage: 'Battery B outage observed', grid: 'Transmission interconnect capacities restricted', toolFailure: 'Next battery tool will reject its command', storm: 'Storm warning: reliability override and reserve headroom', frequency: 'Illustrative grid frequency excursion to 49.72 Hz', forecast: 'Weather forecast updated: cloud and wind outlook revised', maintenance: 'Battery A maintenance requested for next interval' };
    const event = { id: `event-${this.events.length + 1}`, type, tick: this.tick, expiresTick: this.tick + duration, message: labels[type], time: timeAt(this.tick) };
    this.events.push(event);
    if (type === 'outage') this.unavailableUntil.set('battery-b', this.tick + duration);
    if (type === 'toolFailure') this.pendingToolFailure = true;
    if (type === 'maintenance') this.maintenance.push({ id: `maintenance-event-${this.events.length}`, name: 'Battery A requested inspection', assetId: 'battery-a', startTick: this.tick + 1, originalStartTick: this.tick + 1, durationTicks: 4, maxDelayTicks: 8, flexible: true });
    return COPY(event);
  }

  _maintenanceSchedule(tick = this.tick, plannedActions = []) {
    return this.maintenance.map(job => {
      const startTick = plannedActions.find(action => action.jobId === job.id && action.action === 'delay')?.startTick ?? job.startTick;
      return { ...job, startTick, endTick: startTick + job.durationTicks, status: tick < startTick ? 'planned' : tick < startTick + job.durationTicks ? 'active' : 'completed', startTime: timeAt(startTick) };
    });
  }

  _availability(tick = this.tick, plannedActions = []) {
    return this.batteries.map(b => ({ ...b, available: !(this.scenario === 'outage' && b.id === 'battery-b') && (this.unavailableUntil.get(b.id) ?? -1) <= tick && !this._maintenanceSchedule(tick, plannedActions).some(job => job.assetId === b.id && job.status === 'active') }));
  }

  _telemetry(tick, predicted = false, plannedActions = []) {
    const hour = ((10 + tick * DT_HOURS) % 24 + 24) % 24;
    const solarShape = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
    let solarMW = 20 * solarShape;
    let windMW = clamp(6 + 2 * Math.sin(tick * 0.17 + this.seed * 0.1), 0, 12);
    let demandMW = 20 + 2.5 * Math.sin((hour - 8) / 24 * Math.PI * 2) + (hour >= 17 && hour < 21 ? 2 : 0);
    let buyPrice = hour >= 17 && hour < 21 ? 10500 : hour >= 0 && hour < 6 ? 3400 : 5500;
    let gridLimitMW = 18, gridExportLimitMW = 8, uncertaintyPct = 0.08;
    let cloudCoverPct = 8, windSpeedMS = 7 + 1.5 * Math.sin(tick * 0.17 + this.seed * 0.1), gridFrequencyHz = 50 + noise(this.seed, tick, 8) * 0.04;
    let carbonPriceINRPerTonne = 1800, demandResponseIncentiveINRPerMWh = hour >= 17 && hour < 21 ? 1200 : 100;
    const active = this.events.filter(event => tick >= event.tick && tick < event.expiresTick);
    const has = type => active.some(event => event.type === type);
    if (this.scenario === 'cloud' || has('cloud')) { solarMW *= 0.28; uncertaintyPct = 0.20; cloudCoverPct = 80; }
    if (has('wind')) { windMW *= 0.25; windSpeedMS *= 0.5; uncertaintyPct = Math.max(uncertaintyPct, 0.20); }
    if (this.scenario === 'windSurge' || has('windSurge')) { windMW *= 2.4; windSpeedMS = 12; uncertaintyPct = Math.max(uncertaintyPct, 0.15); }
    if (has('forecast')) { solarMW *= 0.65; windMW *= 1.35; cloudCoverPct = 55; windSpeedMS += 2; uncertaintyPct = Math.max(uncertaintyPct, 0.22); }
    if (this.scenario === 'price' || has('price')) buyPrice *= 2.8;
    if (has('demand')) { demandMW += 6; demandResponseIncentiveINRPerMWh = 2000; gridFrequencyHz -= 0.08; }
    if (this.scenario === 'congestion' || has('grid')) gridLimitMW = 2;
    const storm = this.scenario === 'storm' || has('storm');
    if (storm) { solarMW *= 0.35; windMW *= 0.50; demandMW += 2; gridLimitMW = Math.min(gridLimitMW, 8); uncertaintyPct = 0.30; cloudCoverPct = 92; windSpeedMS = 5; gridFrequencyHz -= 0.16; }
    if (this.scenario === 'frequency' || has('frequency')) gridFrequencyHz = 49.72;
    if (this.inputOverrides.cloudCoverPct !== undefined) { cloudCoverPct = this.inputOverrides.cloudCoverPct; solarMW = 20 * solarShape * (1 - cloudCoverPct / 100 * 0.9); }
    if (this.inputOverrides.windSpeedMS !== undefined) { windSpeedMS = this.inputOverrides.windSpeedMS; windMW = 12 * clamp((windSpeedMS - 3) / 9, 0, 1); }
    carbonPriceINRPerTonne = this.inputOverrides.carbonPriceINRPerTonne ?? carbonPriceINRPerTonne;
    demandResponseIncentiveINRPerMWh = this.inputOverrides.demandResponseIncentiveINRPerMWh ?? demandResponseIncentiveINRPerMWh;
    gridFrequencyHz = this.inputOverrides.gridFrequencyHz ?? gridFrequencyHz;
    if (!predicted) {
      solarMW *= 1 + noise(this.seed, tick, 1) * 0.06;
      windMW *= 1 + noise(this.seed, tick, 2) * 0.12;
      demandMW += noise(this.seed, tick, 3) * 1.2;
    } else if (storm) {
      solarMW *= 0.90; windMW *= 0.90; demandMW *= 1.05;
    }
    solarMW = clamp(solarMW, 0, 20); windMW = clamp(windMW, 0, 12); demandMW = Math.max(0, demandMW);
    const maintenanceSchedule = this._maintenanceSchedule(tick, plannedActions);
    const assets = ASSETS.map((asset, index) => {
      const available = !maintenanceSchedule.some(job => job.assetId === asset.id && job.status === 'active');
      const localFactor = predicted ? 1 : 1 + noise(this.seed, tick, 20 + index) * 0.05;
      return { ...asset, available, outputMW: available ? clamp((asset.type === 'solar' ? solarMW * asset.capacityMW / 20 : windMW * asset.capacityMW / 12) * localFactor, 0, asset.capacityMW) : 0 };
    });
    solarMW = sum(assets.filter(a => a.type === 'solar'), a => a.outputMW); windMW = sum(assets.filter(a => a.type === 'wind'), a => a.outputMW);
    const consumers = CONSUMERS.map(c => ({ ...c, demandMW: demandMW * c.share, criticalMW: demandMW * c.share * c.criticalFraction, flexibleMW: demandMW * c.share * (1 - c.criticalFraction) }));
    const gridLines = [
      { id: 'line-main', name: 'Main interconnect', available: true, importLimitMW: gridLimitMW * 10 / 18, exportLimitMW: gridExportLimitMW * 5 / 8 },
      { id: 'line-backup', name: 'Secondary interconnect', available: true, importLimitMW: gridLimitMW * 8 / 18, exportLimitMW: gridExportLimitMW * 3 / 8 }
    ];
    return { solarMW, windMW, demandMW, buyPrice, sellPrice: buyPrice * 0.38, gridLimitMW, gridExportLimitMW, uncertaintyPct, storm,
      gridFrequencyHz, frequencyModel: 'Illustrative 50 Hz response proxy; no AC power-flow or frequency dynamics.', carbonPriceINRPerTonne, demandResponseIncentiveINRPerMWh,
      solarCurtailPenaltyINRPerMWh: 200, windCurtailPenaltyINRPerMWh: storm ? 50 : 350,
      weather: { cloudCoverPct, windSpeedMS, stormAlert: storm, updatedTick: tick, forecastUpdated: has('forecast'), source: 'Seeded synthetic weather; manual overrides supported' },
      consumers, gridLines, maintenanceSchedule, assets, batteryAvailability: Object.fromEntries(this._availability(tick, plannedActions).map(b => [b.id, b.available])) };
  }

  snapshot() {
    const telemetry = this._telemetry(this.tick);
    return { tick: this.tick, time: timeAt(this.tick), scenario: this.scenario, objective: this.objective,
      telemetry: COPY(telemetry), batteries: COPY(this._availability()), events: COPY(this.events),
      backlogMWh: sum(this.backlog, j => j.energyMWh), backlog: COPY(this.backlog), assets: COPY(telemetry.assets), inputOverrides: COPY(this.inputOverrides), maintenanceSchedule: this._maintenanceSchedule(), inspections: this.inspections.map(job => ({ ...COPY(job), status: this.tick >= job.completesTick ? 'completed' : 'simulated_dispatch' })) };
  }

  _forecast(observation, plannedActions = []) {
    return Array.from({ length: HORIZON_STEPS }, (_, step) => ({
      ...(step === 0 ? COPY(observation) : this._telemetry(this.tick + step, true, plannedActions)),
      step, tick: this.tick + step, time: timeAt(this.tick + step),
      confidence: step === 0 ? 1 : 1 - Math.min(0.55, observation.uncertaintyPct + step * 0.025)
    }));
  }

  _maintenanceDecisions(observation) {
    const actions = [];
    const risk = observation.storm || Math.abs(observation.gridFrequencyHz - 50) >= 0.2 || this._availability().some(b => !b.available) || observation.solarMW + observation.windMW + observation.gridLimitMW - observation.demandMW < 2;
    for (const job of observation.maintenanceSchedule.filter(job => job.status === 'planned' && job.startTick === this.tick + 1)) {
      const canDelay = job.flexible && job.startTick < job.originalStartTick + job.maxDelayTicks;
      actions.push({ jobId: job.id, assetId: job.assetId, action: risk && canDelay ? 'delay' : 'schedule', startTick: risk && canDelay ? Math.min(job.startTick + 4, job.originalStartTick + job.maxDelayTicks) : job.startTick,
        reason: risk && canDelay ? 'Defer a flexible job to preserve available capacity during a supply, frequency or weather risk.' : 'Honor the planned maintenance window; safety work cannot be deferred beyond its permitted deadline.' });
    }
    if (observation.storm && !this.inspections.some(inspection => inspection.cause === 'storm' && this.tick < inspection.startTick + 12)) actions.push({ jobId: `inspection-storm-${this.tick}`, assetId: 'wind-1', action: 'inspect', startTick: this.tick, reason: 'Dispatch a simulated inspection team after the storm alert; no equipment control or real crew dispatch occurs.' });
    return actions;
  }

  _executePrepared(p, transactionId, attempt) {
    if (this.committedTransactions.has(transactionId)) return [{ tool: 'transaction.commit', args: { transactionId }, status: 'already_committed', detail: 'Idempotency prevented a duplicate state change.' }];
    const calls = [
      { tool: 'renewable.dispatch', args: { solarMW: p.dispatch.solarMW, windMW: p.dispatch.windMW, solarCurtailMW: p.dispatch.solarCurtailMW, windCurtailMW: p.dispatch.windCurtailMW, curtailMW: p.dispatch.curtailMW } },
      ...p.dispatch.batteryActions.map(action => ({ tool: 'battery.dispatch', args: { ...action } })),
      { tool: 'industrial.schedule', args: { flexMW: p.dispatch.flexMW, restoredMW: p.dispatch.restoredMW, scheduledDemandMW: p.dispatch.scheduledDemandMW, consumers: p.dispatch.consumerActions } },
      { tool: 'grid.route', args: { lineFlows: p.dispatch.lineFlows, frequencyAfterHz: p.dispatch.frequencyAfterHz, supportMW: p.dispatch.frequencySupportMW, model: 'Illustrative frequency proxy and parallel transport links' } },
      { tool: 'market.trade', args: { importMW: p.dispatch.importMW, exportMW: p.dispatch.exportMW, carbonCost: p.metrics.carbonCost, incentiveRevenue: p.metrics.incentiveRevenue } },
      ...p.dispatch.maintenanceActions.map(action => ({ tool: action.action === 'inspect' ? 'inspection.dispatch' : `maintenance.${action.action}`, args: action }))
    ];
    const results = [];
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index];
      const args = { ...call.args, transactionId, idempotencyKey: `${transactionId}:${attempt}:${index}`, simulated: true };
      if (this.pendingToolFailure && call.tool === 'battery.dispatch' && call.args.id === 'battery-b') {
        this.pendingToolFailure = false;
        this.unavailableUntil.set('battery-b', this.tick + 8);
        results.push({ ...call, args, status: 'rejected', detail: 'Simulated battery B tool outage. Prepared commands were rolled back; no energy or money changed.' });
        results.push({ tool: 'transaction.rollback', args: { transactionId, simulated: true }, status: 'rolled_back', detail: 'Every command in this attempt was only prepared. The authoritative state remains unchanged.' });
        return results;
      }
      results.push({ ...call, args, status: 'prepared', detail: 'Simulated command acknowledged and staged for atomic commit.' });
    }
    return results;
  }

  cycle() {
    const initialSnapshot = this.snapshot();
    const observation = initialSnapshot.telemetry;
    let maintenanceActions = this._maintenanceDecisions(observation);
    let forecast = this._forecast(observation, maintenanceActions);
    const requestedObjective = this.objective;
    const frequencyAlert = Math.abs(observation.gridFrequencyHz - 50) >= 0.2;
    const effectiveObjective = observation.storm || frequencyAlert ? 'reliability' : requestedObjective;
    let beforeBatteries = this._availability();
    const backlogBefore = COPY(this.backlog);
    const transactionId = `sim-${this.seed}-tick-${this.tick}`;
    let chosen = planHorizon(forecast, beforeBatteries, backlogBefore, this.tick, effectiveObjective, observation.storm);
    let p = chosen.proposal;
    p.dispatch.maintenanceActions = COPY(maintenanceActions);
    let validation = validateDispatch({ observation, batteries: beforeBatteries, dispatch: p.dispatch, nextBatteries: p.batteries, backlogBefore, backlogAfter: p.backlog, tick: this.tick, reserveFraction: chosen.weights.floor });
    if (!validation.passed) throw new Error(`Planner proposal failed independent validation: ${validation.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`);
    const execution = this._executePrepared(p, transactionId, 1);
    const failed = execution.some(result => result.status === 'rejected');
    let adaptation = observation.storm ? 'Storm uncertainty changed the effective objective to reliability; increased reserve and conservative future forecasts.' : frequencyAlert ? 'A frequency excursion changed the effective objective to reliability. Battery response is evaluated with an explicitly illustrative frequency proxy.' : 'Forecast and observations refreshed; only the first 15-minute action is applied, then the horizon is replanned.';
    if (failed) {
      beforeBatteries = this._availability();
      observation.batteryAvailability = Object.fromEntries(beforeBatteries.map(b => [b.id, b.available]));
      maintenanceActions = this._maintenanceDecisions(observation);
      forecast = this._forecast(observation, maintenanceActions);
      const retry = planHorizon(forecast, beforeBatteries, backlogBefore, this.tick, effectiveObjective, observation.storm);
      retry.candidateCount += chosen.candidateCount;
      chosen = retry; p = chosen.proposal;
      p.dispatch.maintenanceActions = COPY(maintenanceActions);
      validation = validateDispatch({ observation, batteries: beforeBatteries, dispatch: p.dispatch, nextBatteries: p.batteries, backlogBefore, backlogAfter: p.backlog, tick: this.tick, reserveFraction: chosen.weights.floor });
      if (!validation.passed) throw new Error('Replanned proposal failed independent validation. No physical state was committed.');
      execution.push(...this._executePrepared(p, transactionId, 2));
      adaptation = 'Battery B tool rejected its command. The entire prepared attempt rolled back; availability was observed again, the horizon was replanned, and the replacement passed validation before one atomic commit.';
    }
    // Validate the exact staged response again before committing authoritative state.
    validation = validateDispatch({ observation, batteries: beforeBatteries, dispatch: p.dispatch, nextBatteries: p.batteries, backlogBefore, backlogAfter: p.backlog, tick: this.tick, reserveFraction: chosen.weights.floor });
    if (!validation.passed || execution.slice(execution.findLastIndex(x => x.status === 'rolled_back') + 1).some(x => x.status === 'rejected')) throw new Error('Staged transaction is invalid; state was not committed.');
    if (this.committedTransactions.has(transactionId)) throw new Error('Duplicate cycle transaction blocked.');
    const baselineConsumers = observation.consumers.map(c => { const action = p.dispatch.consumerActions.find(a => a.id === c.id); return { ...c, demandMW: action.scheduledMW, criticalMW: c.criticalMW, flexibleMW: Math.max(0, action.scheduledMW - c.criticalMW) }; });
    const baselineDispatch = proposal({ ...observation, demandMW: p.dispatch.scheduledDemandMW, consumers: baselineConsumers }, [], [], this.tick, 0, 0, false, 0, p.dispatch.curtailSource).dispatch;
    const baseline = metricsFor(baselineDispatch, observation);
    baseline.description = 'No storage; identical renewable observations, named-consumer scheduled demand, line limits, carbon prices, source-curtailment priority and demand-response settlement. Shift compensation and incentive revenue are included in both. This comparison isolates storage, not independent whole-system optimization.';
    baseline.cost += p.metrics.demandShiftCost;
    baseline.cost -= p.metrics.incentiveRevenue;
    baseline.demandShiftCost = p.metrics.demandShiftCost;
    baseline.incentiveRevenue = p.metrics.incentiveRevenue;
    baseline.dispatch = baselineDispatch;
    this.batteries = COPY(p.batteries); this.backlog = COPY(p.backlog);
    for (const action of maintenanceActions) {
      if (action.action === 'delay') this.maintenance.find(job => job.id === action.jobId).startTick = action.startTick;
      if (action.action === 'inspect') this.inspections.push({ ...COPY(action), cause: 'storm', status: 'simulated_dispatch', completesTick: this.tick + 2 });
    }
    this.committedTransactions.add(transactionId);
    const rolledBackAt = execution.findIndex(x => x.tool === 'transaction.rollback');
    for (const item of execution) if (item.status === 'prepared') {
      const ownIndex = execution.indexOf(item);
      item.status = rolledBackAt >= 0 && ownIndex < rolledBackAt ? 'rolled_back' : 'committed';
      item.detail = item.status === 'committed' ? 'Simulated setpoint committed atomically after all checks passed.' : 'Prepared command discarded; no physical state changed.';
    }
    execution.push({ tool: 'transaction.commit', args: { transactionId, simulated: true }, status: 'committed', detail: 'Exactly one state transition; all operations are simulated.' });
    const d = p.dispatch;
    const risks = [];
    if (observation.uncertaintyPct >= 0.2) risks.push('High renewable forecast uncertainty');
    if (beforeBatteries.some(b => !b.available)) risks.push('One battery is unavailable');
    if (observation.gridLimitMW < 18) risks.push('Grid import capacity is restricted');
    if (frequencyAlert) risks.push('Frequency proxy outside ±0.20 Hz; reliability objective takes priority');
    if (Math.abs(d.frequencyAfterHz - 50) > 0.20) risks.push('Frequency proxy remains outside target; this sandbox does not certify electrical stability');
    if (maintenanceActions.some(a => a.action === 'delay')) risks.push('Maintenance deferred within its permitted service window');
    if (d.shedMW > EPS) risks.push(`CRITICAL: ${d.shedMW.toFixed(2)} MW demand cannot be supplied within physical constraints`);
    if (d.backlogMWh > EPS) risks.push(`${d.backlogMWh.toFixed(2)} MWh flexible load must return within one hour`);
    const summary = `${effectiveObjective} criteria: ₹${p.metrics.cost.toFixed(0)} operating cost, ${p.metrics.carbonKg.toFixed(0)} kg grid CO₂, ${d.shedMW.toFixed(2)} MW unserved.`;
    const displayThreshold = 0.005;
    const planSummary = `${d.dischargeMW >= displayThreshold ? `Discharge ${d.dischargeMW.toFixed(2)} MW` : d.chargeMW >= displayThreshold ? `Charge ${d.chargeMW.toFixed(2)} MW` : 'Hold batteries'}; ${d.importMW >= displayThreshold ? `buy ${d.importMW.toFixed(2)} MW` : d.exportMW >= displayThreshold ? `sell ${d.exportMW.toFixed(2)} MW` : 'no material grid trade'}${d.flexMW >= displayThreshold ? `; shift ${d.flexMW.toFixed(2)} MW` : ''}${d.restoredMW >= displayThreshold ? `; restore ${d.restoredMW.toFixed(2)} MW` : ''}.`;
    const record = {
      tick: this.tick, time: timeAt(this.tick), observation: { ...COPY(observation), forecast: COPY(forecast), batteries: COPY(beforeBatteries), backlogMWh: sum(backlogBefore, j => j.energyMWh) },
      analysis: { criteria: effectiveObjective, requestedObjective, effectiveObjective, summary, risks, reserveFraction: chosen.weights.floor,
        weights: COPY(chosen.weights), scoreComponents: scoreComponentsFor(p, chosen.weights),
        criteriaDescription: 'Minimize weighted operating cost (energy, carbon price, degradation, curtailment contracts and shift compensation minus incentive revenue), grid carbon, unserved energy, curtailment, reserve deficit and illustrative frequency deviation beyond a 0.08 Hz deadband. Critical consumer loads are protected before flexible loads. Horizon ranking values remaining battery inventory and pending load obligations.',
        scoreScope: 'Components describe the executed tick. Plan score describes the full selected horizon with terminal inventory and backlog valuation.',
        reserveRationale: observation.storm ? 'Storm: 35% hard discharge floor, conservative future renewable output and higher demand; preserve uncertainty headroom.' : `${(chosen.weights.floor * 100).toFixed(1)}% hard discharge floor for ${effectiveObjective}, including renewable uncertainty headroom; soft 45% reserve target. An already depleted battery cannot discharge until recharged above the new floor.` },
      plan: { summary: planSummary, actions: COPY(d.batteryActions), objective: effectiveObjective, score: round(chosen.score, 2), candidateCount: chosen.candidateCount,
        horizonSteps: HORIZON_STEPS, horizonMinutes: HORIZON_STEPS * 15, beamWidth: 12, method: 'Bounded beam search over discrete feasible commands; no global optimality claim.' },
      execution, validation, adaptation, dispatch: COPY(d), batteries: COPY(this.batteries), metrics: COPY(p.metrics), baseline: COPY(baseline),
      stages: [
        { stage: 'observe', summary: 'Read simulated sensors and market', detail: `${ASSETS.length} renewable assets, two batteries, three industrial consumers, two transfer lines, weather, frequency, maintenance, carbon prices and demand-response incentives. Forecast refreshed for eight ticks.`, status: 'complete' },
        { stage: 'analyze', summary: `Choose ${effectiveObjective} criteria`, detail: summary + (observation.storm ? ' Storm overrides the requested objective.' : ''), status: risks.some(r => r.startsWith('CRITICAL')) ? 'critical' : 'complete' },
        { stage: 'plan', summary: 'Search feasible action sequences', detail: `${chosen.candidateCount} candidate transitions evaluated over a two-hour horizon; first action selected. ${planSummary}`, status: 'complete' },
        { stage: 'execute', summary: failed ? 'Roll back, replan and stage replacement' : 'Run simulated dispatch tools', detail: failed ? adaptation : 'Source-specific renewables, batteries, named consumer schedules, line routes, market trades and maintenance/inspection commands were staged with idempotency keys.', status: failed ? 'recovered' : 'complete' },
        { stage: 'validate', summary: `${validation.checks.length} independent checks passed`, detail: 'Power balance, per-battery limits, health ledger, SOC, source curtailment, individual line caps, consumer obligations, critical-load protection, frequency proxy and maintenance windows verified before atomic commit.', status: 'complete' },
        { stage: 'adapt', summary: observation.storm ? 'Increase uncertainty headroom' : failed ? 'Use observed battery unavailability' : 'Recede the planning horizon', detail: adaptation, status: 'complete' }
      ],
      alternatives: chosen.alternatives, forecast: COPY(forecast),
      audit: { transactionId, commits: 1, retries: failed ? 1 : 0, backlogBefore, backlogAfter: COPY(this.backlog), reserveFraction: chosen.weights.floor, simulated: true }
    };
    this.history.push(COPY(record)); this.tick++;
    return COPY(record);
  }

  aggregate() {
    const total = key => sum(this.history, record => record.metrics[key] || 0);
    const baselineCost = sum(this.history, record => record.baseline.cost);
    const cost = total('cost'), servedMWh = total('servedMWh'), unservedMWh = total('unservedMWh');
    const renewableUsedMWh = total('renewableUsedMWh'), renewableAvailableMWh = total('renewableAvailableMWh');
    const baselineUnservedMWh = sum(this.history, record => record.baseline.unservedMWh);
    const baselineServedMWh = sum(this.history, record => record.baseline.servedMWh);
    const pendingShiftMWh = sum(this.backlog, j => j.energyMWh);
    return {
      cost, baselineCost, carbonKg: total('carbonKg'), baselineCarbonKg: sum(this.history, record => record.baseline.carbonKg),
      renewableUsedMWh, renewableAvailableMWh, servedMWh, unservedMWh, curtailmentMWh: total('curtailmentMWh'),
      reliabilityPercent: servedMWh + unservedMWh > EPS ? servedMWh / (servedMWh + unservedMWh) * 100 : 100,
      renewableUtilizationPercent: renewableAvailableMWh > EPS ? renewableUsedMWh / renewableAvailableMWh * 100 : 100,
      savings: baselineCost - cost, savingsPercent: baselineCost > EPS ? (baselineCost - cost) / baselineCost * 100 : null,
      shiftedMWh: total('shiftedMWh'), restoredMWh: total('restoredMWh'), backlogMWh: pendingShiftMWh, pendingShiftMWh,
      baselineUnservedMWh, baselineServedMWh,
      baselineReliabilityPercent: baselineServedMWh + baselineUnservedMWh > EPS ? baselineServedMWh / (baselineServedMWh + baselineUnservedMWh) * 100 : 100,
      costComparison: (pendingShiftMWh > EPS ? 'Provisional operating costs: flexible energy remains pending in both schedules.' : baselineUnservedMWh > unservedMWh + EPS ? 'Operating costs serve different delivered energy; compare service reliability alongside savings.' : 'Operating costs for the same scheduled demand.') + ' Includes starting battery inventory; excludes capital cost and does not establish payback.',
      initialStoredMWh: this.initialStoredMWh, finalStoredMWh: sum(this.batteries, b => b.socMWh),
      batteryThroughputMWh: total('batteryThroughputMWh'), ticks: this.history.length,
      carbonCost: total('carbonCost'), incentiveRevenue: total('incentiveRevenue'), degradationCost: total('degradationCost'), sourceCurtailCost: total('sourceCurtailCost'),
      operatingMargin: -cost, criticalUnservedMWh: total('criticalUnservedMWh'), solarCurtailmentMWh: total('solarCurtailmentMWh'), windCurtailmentMWh: total('windCurtailmentMWh'),
      averageFrequencyDeviationHz: this.history.length ? total('frequencyDeviationHz') / this.history.length : 0,
      minimumBatteryHealthPercent: Math.min(...this.batteries.map(b => b.healthPercent)),
      maintenanceDelays: sum(this.history, r => r.dispatch.maintenanceActions.filter(a => a.action === 'delay').length),
      scheduledMaintenanceActions: sum(this.history, r => r.dispatch.maintenanceActions.filter(a => a.action === 'schedule').length), inspectionDispatches: this.inspections.length
    };
  }
}
