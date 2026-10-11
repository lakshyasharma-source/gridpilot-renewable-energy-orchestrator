const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fmt = (value, digits = 1) => num(value).toLocaleString('en-IN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
const money = (value) => `₹${fmt(value, 0)}`;
const percent = (value) => Math.max(0, Math.min(100, num(value)));
const detail = (value) => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
const titles = {overview: ['A clearer view. A smarter dispatch.', 'Coordinate clean energy, battery storage, and industrial demand.', 'Overview'], agent: ['Autonomy you can inspect.', 'Follow every observation, decision, tool call, and operating check.', 'Agent activity'], scenarios: ['Make uncertainty observable.', 'Stress-test the next decision with changing conditions and injected events.', 'Scenarios'], architecture: ['Built to explain its decisions.', 'A local agentic simulation with a transparent planning and execution loop.', 'Architecture']};
const eventTypes = [
  {id:'cloud',label:'Cloud cover',icon:'☁',description:'Reduce available solar output'},
  {id:'wind',label:'Wind drop',icon:'≋',description:'Disrupt renewable generation'},
  {id:'windSurge',label:'Wind surge',icon:'↑',description:'Increase wind output and test surplus handling'},
  {id:'price',label:'Price spike',icon:'↗',description:'Increase the grid import tariff'},
  {id:'demand',label:'Demand surge',icon:'ϟ',description:'Raise industrial consumption'},
  {id:'outage',label:'Battery outage',icon:'▯',description:'Make a storage unit unavailable'},
  {id:'grid',label:'Grid constraint',icon:'⌁',description:'Reduce grid import capacity'},
  {id:'toolFailure',label:'Tool failure',icon:'!',description:'Test a simulated execution failure'},
  {id:'storm',label:'Storm alert',icon:'⛈',description:'Trigger reliability-first adaptation'},
  {id:'frequency',label:'Frequency dip',icon:'∿',description:'Test the illustrative frequency-response signal'},
  {id:'forecast',label:'Weather update',icon:'◷',description:'Revise cloud, wind and forecast uncertainty'},
  {id:'maintenance',label:'Maintenance due',icon:'⚒',description:'Test scheduling, postponement and inspection'}
];
const stageLabels = ['Observe','Analyze','Plan','Execute','Validate','Adapt'];
const iconPaths = {
  solar:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2 2 0 1 1-2 2"/>',
  battery:'<rect x="3" y="6" width="16" height="12" rx="2"/><path d="M19 10h2v4h-2M8 9v6M5 12h6m3 0h3"/>',
  grid:'<path d="m12 2-7 20m7-20 7 20M7 7h10M5 13h14M4 18h16M7 7l12 11M17 7 4 18"/>',
  demand:'<path d="M3 21V10l6 3V8l7 4V3h4v18H3Z"/><path d="M7 17h2m4 0h2m3 0h1"/>',
  flex:'<path d="M4 6h16M4 18h16M8 3 5 6l3 3m8 6 3 3-3 3M6 12h12"/>'
};
const icon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[type] || iconPaths.grid}</svg>`;
let simulation;
let scenarios = [];
let objectives = [];
let currentView = 'overview';
let selectedTick = null;
let autoTimer = null;
let dayRunning = false;
let dayToken = 0;
let injectedCount = 0;
let lastInjection = '';
let latestAggregate = {};
let serviceAlertActive = false;
let inputDirty = false;
let inputSyncPending = true;

function announce(message, error = false) {
  $('#feedback').textContent = message;
  $('#feedback').classList.toggle('error', error);
}

function switchView(view) {
  if (!titles[view]) return;
  currentView = view;
  $$('.view-panel').forEach(panel => { panel.hidden = panel.id !== `view-${view}`; });
  $$('.nav-button').forEach(button => {const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  const [title, subtitle, label] = titles[view];
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#view-breadcrumb').textContent = label;
  history.replaceState(null, '', `#${view}`);
}

function renderChart(records) {
  const rows = records.slice(-96);
  if (!rows.length) { $('#dispatch-chart').innerHTML = '<div class="empty-state">Run a cycle to see the dispatch history.</div>'; return; }
  const width = Math.max(280,$('#dispatch-chart').clientWidth), height = Math.max(200,$('#dispatch-chart').clientHeight), left = 38, right = 10, top = 20, bottom = 34;
  const w = width-left-right, h = height-top-bottom;
  const series = rows.map(r => ({renewable: num(r.dispatch?.solarMW)+num(r.dispatch?.windMW), demand: num(r.dispatch?.demandMW), grid: num(r.dispatch?.importMW), time:r.time}));
  const maxValue = Math.max(1, ...series.flatMap(r => [r.renewable,r.demand,r.grid]));
  const step = maxValue > 30 ? 10 : maxValue > 12 ? 5 : maxValue > 5 ? 2 : 1;
  const ceiling = Math.ceil(maxValue / step) * step;
  const x = i => left + i * w / Math.max(1, rows.length-1);
  const y = v => top + h - Math.max(0,v) / ceiling * h;
  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="renewable-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#90b979" stop-opacity=".18"/><stop offset="100%" stop-color="#90b979" stop-opacity=".01"/></linearGradient></defs>`;
  for (let i=0; i<=4; i++) {
    const value=ceiling*i/4, py=y(value);
    svg += `<line x1="${left}" x2="${width-right}" y1="${py}" y2="${py}" stroke="#eef1e7" stroke-width="1"/><text x="${left-10}" y="${py+4}" fill="#8a977e" font-size="11" text-anchor="end">${fmt(value,value%1===0?0:1)}</text>`;
  }
  svg += `<text x="${left-10}" y="10" fill="#8a977e" font-size="10" text-anchor="end">MW</text>`;
  const labelIndexes = rows.length===1 ? [0] : [...new Set([0, Math.round((rows.length-1)/4),Math.round((rows.length-1)/2), Math.round((rows.length-1)*3/4),rows.length-1])];
  labelIndexes.forEach((i,j) => {svg += `<text x="${x(i)}" y="${height-8}" fill="#8a977e" font-size="11" text-anchor="${j===0?'start':j===labelIndexes.length-1?'end':'middle'}">${esc(rows[i].time)}</text>`;});
  const paths = (key) => series.map((r,i) => `${i===0?'M':'L'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
  if (rows.length>1) svg += `<path d="${paths('renewable')} L${x(rows.length-1)},${y(0)} L${x(0)},${y(0)}Z" fill="url(#renewable-fill)"/>`;
  [['renewable','#86aa72',''],['demand','#365a47',''],['grid','#c7a066','4 4']].forEach(([key,color,dash]) => {
    svg += `<path d="${paths(key)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
    const end = series.length-1;
    svg += `<circle cx="${x(end)}" cy="${y(series[end][key])}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`;
  });
  svg += '</svg>';
  $('#dispatch-chart').innerHTML = svg;
  $('#chart-range').textContent = `${rows[0].time} – ${rows.at(-1).time} · ${rows.length} intervals`;
  $('#dispatch-chart').setAttribute('aria-label',`Power in MW across ${rows.length} 15-minute intervals. Latest renewable supply ${fmt(series.at(-1).renewable)} MW, demand ${fmt(series.at(-1).demand)} MW, grid import ${fmt(series.at(-1).grid)} MW.`);
}

function renderSpark(selector, values, color) {
  const data = values.slice(-24);
  if (data.length<2) { $(selector).innerHTML=''; return; }
  const min=Math.min(0,...data), max=Math.max(1,...data);
  const points=data.map((v,i)=>`${(i*104/(data.length-1)).toFixed(1)},${(24-(v-min)/(max-min)*20).toFixed(1)}`).join(' ');
  $(selector).innerHTML=`<svg viewBox="0 0 104 27"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
}

function renderKpis(a, records) {
  $('#kpi-cost').textContent=money(a.cost);
  const savings=num(a.baselineCost)-num(a.cost);
  const savingsClass=savings>=0?'positive':'negative';
  $('#cost-context').innerHTML=`<span class="${savingsClass}">${savings>=0?'↓':'↑'} ${money(Math.abs(savings))}</span> vs ${money(a.baselineCost)} baseline`;
  const carbonDelta=num(a.baselineCarbonKg)-num(a.carbonKg);
  $('#carbon-kpi-label').textContent=carbonDelta>=0?'Avoided grid emissions':'Additional grid emissions';
  const useTonnes=Math.abs(carbonDelta)>=1000;
  $('#kpi-carbon').innerHTML=`${fmt(Math.abs(carbonDelta)/(useTonnes?1000:1),useTonnes?2:0)}<small>${useTonnes?'t':'kg'}</small>`;
  $('#carbon-context').textContent=`${fmt(a.carbonKg,0)} kg emitted · ${fmt(a.baselineCarbonKg,0)} kg baseline`;
  $('#kpi-renewables').innerHTML=`${fmt(a.renewableUtilizationPercent,1)}<small>%</small>`;
  $('#renewable-context').textContent=`${fmt(a.renewableUsedMWh,2)} / ${fmt(a.renewableAvailableMWh,2)} MWh used`;
  $('#renewable-meter').style.width=`${percent(a.renewableUtilizationPercent)}%`;
  $('#kpi-reliability').innerHTML=`${fmt(a.reliabilityPercent,1)}<small>%</small>`;
  $('#reliability-context').textContent=`${fmt(a.servedMWh,2)} MWh served · ${fmt(a.unservedMWh,2)} MWh unserved`;
  $('#reliability-meter').style.width=`${percent(a.reliabilityPercent)}%`;
  const pending=num(a.pendingShiftMWh, num(records.at(-1)?.dispatch?.backlogMWh));
  const baselineServed=records.reduce((sum,r)=>sum+num(r.baseline?.servedMWh),0);
  const baselineUnserved=records.reduce((sum,r)=>sum+num(r.baseline?.unservedMWh),0);
  const baselineReliability=Number.isFinite(Number(a.baselineReliabilityPercent)) ? num(a.baselineReliabilityPercent) : baselineServed+baselineUnserved>0 ? baselineServed/(baselineServed+baselineUnserved)*100 : 100;
  $('#baseline-note').textContent=`No-storage baseline: ${fmt(baselineReliability,1)}% demand served. Current plan: ${fmt(a.reliabilityPercent,1)}% served; ${fmt(pending,2)} MWh shifted demand pending. ${a.costComparison || 'Cost comparisons also reflect storage inventory and service levels.'}`;
  renderSpark('#cost-spark',records.map(r=>num(r.metrics?.cost)),'#9ab684');
  renderSpark('#carbon-spark',records.map(r=>num(r.metrics?.carbonKg)),'#9db09a');
}

function renderBalance(record) {
  const d=record?.dispatch || {};
  const rows=[
    ['solar','Solar generation','Available renewable supply',num(d.solarMW)],
    ['wind','Wind generation','Available renewable supply',num(d.windMW)],
    ['battery',num(d.chargeMW)>0?'Battery charging':'Battery discharge',num(d.chargeMW)>0?'Local bus → stored energy':'Stored energy → local bus',num(d.chargeMW)>0?num(d.chargeMW):num(d.dischargeMW)],
    ['grid',num(d.exportMW)>0?'Grid export':'Grid import',num(d.exportMW)>0?'Sold to the simulated market':'Purchased from the simulated market',num(d.exportMW)>0?num(d.exportMW):num(d.importMW)],
    ['demand','Industrial load served',`${fmt(num(d.scheduledDemandMW,d.demandMW))} MW scheduled · ${fmt(d.shedMW)} MW unserved`,Math.max(0,num(d.scheduledDemandMW,d.demandMW)-num(d.shedMW))],
    ['flex','Demand flexibility',`${fmt(num(d.backlogMWh))} MWh pending · ${fmt(num(d.restoredMW))} MW restored`,num(d.flexMW)]
  ];
  $('#energy-balance').innerHTML=rows.map(([type,label,caption,value],i)=>`${i===4?'<div class="balance-divider"></div>':''}<div class="balance-row ${type==='demand'?'demand':''}"><span class="balance-icon">${icon(type)}</span><div><strong>${esc(label)}</strong><small>${esc(caption)}</small></div><span class="power-value">${fmt(value)}<small>MW</small></span></div>`).join('');
  if(num(d.curtailMW)>0) $('#energy-balance').insertAdjacentHTML('beforeend',`<div class="balance-row"><span class="balance-icon">${icon('solar')}</span><div><strong>Renewable curtailment</strong><small>${fmt(d.solarCurtailMW)} MW solar · ${fmt(d.windCurtailMW)} MW wind</small></div><span class="power-value">${fmt(d.curtailMW)}<small>MW</small></span></div>`);
  const passed=record?.validation?.passed===true;
  $('#balance-status').textContent=passed?'Validated':'Check result';
  $('#balance-status').classList.toggle('failed',!passed);
}

function renderBatteries(batteries) {
  const rows=Array.isArray(batteries)?batteries:[];
  const total=rows.reduce((sum,b)=>sum+num(b.socMWh),0);
  $('#battery-total').textContent=`${fmt(total,1)} MWh stored`;
  $('#battery-cards').innerHTML=rows.map(b=>{
    const state=percent(num(b.socMWh)/Math.max(.01,num(b.capacityMWh))*100);
    return `<div class="battery-item"><div class="battery-title"><strong>${esc(b.name || b.id)}</strong><small>${b.available===false?'Unavailable':`${fmt(state,0)}% SOC`}</small></div><div class="battery-meter" role="meter" aria-label="${esc(b.name || b.id)} state of charge" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.toFixed(1)}"><span style="width:${state.toFixed(1)}%;${b.available===false?'opacity:.3;':''}"></span></div><div class="battery-detail"><span>${fmt(b.socMWh,1)} / ${fmt(b.capacityMWh,1)} MWh</span><span>${fmt(b.maxMW,1)} MW limit</span></div><div class="battery-detail battery-health"><span>${fmt(num(b.healthPercent,100),2)}% modeled health</span><span>${fmt(b.throughputMWh,2)} MWh throughput</span></div></div>`;
  }).join('') || '<div class="empty-state">No storage units reported.</div>';
}

function renderPortfolio(record, snapshot) {
  const o=record?.observation || snapshot.telemetry || {}, d=record?.dispatch || {}, weather=o.weather || {};
  const observed=[
    ['Grid frequency',`${fmt(num(o.gridFrequencyHz,50),2)} Hz`,'Illustrative planning signal'],
    ['Carbon price',`${money(o.carbonPriceINRPerTonne)} / t`,'Applied to grid-import emissions'],
    ['Demand incentive',`${money(o.demandResponseIncentiveINRPerMWh)} / MWh`,'Revenue for eligible deferral'],
    ['Cloud cover',`${fmt(weather.cloudCoverPct,0)}%`,'Synthetic weather forecast'],
    ['Wind speed',`${fmt(weather.windSpeedMS,1)} m/s`,'Synthetic weather forecast'],
    ['Weather status',weather.stormAlert || o.storm?'Storm alert':'No storm alert',`Updated cycle ${num(weather.updatedTick,record?.tick)+1}`]
  ];
  $('#telemetry-cards').innerHTML=observed.map(([label,value,caption])=>`<div class="telemetry-item"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(caption)}</small></div>`).join('');
  const consumers=Array.isArray(o.consumers)?o.consumers:[], actions=Array.isArray(d.consumerActions)?d.consumerActions:[];
  $('#consumer-cards').innerHTML=consumers.map(c=>{
    const a=actions.find(row=>row.id===c.id) || {}, shortfall=num(a.shedMW), shifted=num(a.shiftMW), restored=num(a.restoredMW);
    const criticalShortfall=num(a.criticalShedMW,num(a.criticalUnservedMW,Math.max(0,num(c.criticalMW)-num(a.servedMW,c.demandMW))));
    return `<div class="consumer-card ${shortfall>0.005?'service-shortfall':''}"><div class="consumer-heading"><strong>${esc(c.name || c.id)}</strong><span>${fmt(c.demandMW)} MW demand</span></div><div class="consumer-split"><span><i class="legend-dot ink"></i>${fmt(c.criticalMW)} MW critical</span><span><i class="legend-dot green"></i>${fmt(c.flexibleMW)} MW flexible</span></div><div class="consumer-actions"><span>${fmt(num(a.servedMW,c.demandMW))} MW served</span><span>${shifted>0.005?`${fmt(shifted)} MW deferred`:restored>0.005?`${fmt(restored)} MW restored`:'No shift this cycle'}</span></div>${shortfall>0.005?`<div class="consumer-alert">${fmt(shortfall,2)} MW unserved · ${fmt(criticalShortfall,2)} MW critical shortfall</div>`:''}</div>`;
  }).join('') || '<div class="empty-state">Consumer observations appear after the next cycle.</div>';
  const lines=Array.isArray(o.gridLines)?o.gridLines:[], flows=Array.isArray(d.lineFlows)?d.lineFlows:[];
  $('#grid-line-cards').innerHTML=lines.map(line=>{
    const flow=flows.find(row=>row.id===line.id) || {}, importMW=num(flow.importMW), exportMW=num(flow.exportMW);
    const used=importMW>0.005?importMW:exportMW, capacity=importMW>0.005?num(line.importLimitMW):num(line.exportLimitMW), utilization=capacity>0?percent(used/capacity*100):0;
    return `<div class="line-card"><div class="consumer-heading"><strong>${esc(line.name || line.id)}</strong><span class="${line.available===false?'negative':''}">${line.available===false?'Unavailable':`${fmt(utilization,0)}% ${used>0.005?'utilized':'idle'}`}</span></div><div class="line-meter"><span style="width:${utilization.toFixed(1)}%"></span></div><div class="line-details"><span>Import ${fmt(importMW)} / ${fmt(line.importLimitMW)} MW</span><span>Export ${fmt(exportMW)} / ${fmt(line.exportLimitMW)} MW</span></div></div>`;
  }).join('') || '<div class="empty-state">Grid-line observations appear after the next cycle.</div>';
  $('#frequency-result').innerHTML=`<strong>${fmt(num(o.gridFrequencyHz,50),2)} → ${fmt(num(d.frequencyAfterHz,o.gridFrequencyHz ?? 50),2)} Hz</strong><span>Observed → modeled response · target 50.00 Hz</span><small>Illustrative proxy only. Battery dispatch affects this planning signal; real frequency stability is outside this simulation.</small>`;
  const assets=Array.isArray(o.assets)?o.assets:[];
  $('#renewable-assets').innerHTML=assets.map(a=>`<div class="asset-card ${a.available===false?'unavailable':''}"><span class="asset-icon">${icon(a.type==='wind'?'wind':'solar')}</span><div><strong>${esc(a.name || a.id)}</strong><small>${a.available===false?'Unavailable':`${fmt(a.outputMW)} / ${fmt(a.capacityMW)} MW`}</small></div></div>`).join('') || '<div class="empty-state">Renewable assets appear after the next cycle.</div>';
  $('#curtailment-summary').textContent=`This cycle: ${fmt(d.solarCurtailMW)} MW solar curtailed · ${fmt(d.windCurtailMW)} MW wind curtailed. Surplus is stored or exported where feasible.`;
  const jobs=Array.isArray(o.maintenanceSchedule)?o.maintenanceSchedule:Array.isArray(snapshot.maintenanceSchedule)?snapshot.maintenanceSchedule:[], decisions=Array.isArray(d.maintenanceActions)?d.maintenanceActions:[];
  $('#maintenance-cards').innerHTML=jobs.map(job=>{
    const decision=decisions.find(a=>a.jobId===(job.id || job.jobId)), status=decision?.action || job.status || 'planned';
    const asset=assets.find(a=>a.id===job.assetId), battery=(record?.batteries || snapshot.batteries || []).find(a=>a.id===job.assetId);
    return `<div class="maintenance-card"><div class="consumer-heading"><strong>${esc(job.name || asset?.name || battery?.name || job.assetId || job.id)}</strong><span class="receipt-badge">${esc(status)}</span></div><small>${esc(job.assetId || '')} · start cycle ${num(decision?.startTick,job.startTick)+1}${job.durationTicks?` · ${fmt(job.durationTicks*.25,1)} h window`:''}</small><p>${esc(decision?.reason || job.reason || 'Agent checks reserve, forecasts and availability before scheduling.')}</p></div>`;
  }).join('') || '<div class="empty-state">No maintenance jobs in the current schedule. Inject “Maintenance due” to demonstrate the workflow.</div>';
}

function renderInputEditor(snapshot) {
  const o=snapshot.telemetry || {}, overrides=snapshot.inputOverrides || {}, weather=o.weather || {};
  const values={'#input-carbon':num(overrides.carbonPriceINRPerTonne,o.carbonPriceINRPerTonne), '#input-incentive':num(overrides.demandResponseIncentiveINRPerMWh,o.demandResponseIncentiveINRPerMWh), '#input-frequency':num(overrides.gridFrequencyHz,o.gridFrequencyHz ?? 50), '#input-cloud':num(overrides.cloudCoverPct,weather.cloudCoverPct), '#input-wind':num(overrides.windSpeedMS,weather.windSpeedMS)};
  if(inputSyncPending || !inputDirty && !$('#input-form').contains(document.activeElement)){
    Object.entries(values).forEach(([selector,value])=>{$(selector).value=String(Math.round(value*(selector==='#input-frequency'?100:selector==='#input-wind'?10:1))/(selector==='#input-frequency'?100:selector==='#input-wind'?10:1));});
    inputSyncPending=false;
  }
  $('#input-mode').textContent=Object.keys(overrides).length?'Manual inputs active':'Synthetic profiles';
}

function getStages(record) {
  if (Array.isArray(record?.stages) && record.stages.length) return record.stages;
  return [
    {stage:'Observe',summary:detail(record?.observation),detail:'Telemetry recorded',status:'complete'},
    {stage:'Analyze',summary:record?.analysis?.summary,detail:record?.analysis?.risks,status:'complete'},
    {stage:'Plan',summary:record?.plan?.summary,detail:record?.plan?.actions,status:'complete'},
    {stage:'Execute',summary:`${record?.execution?.length || 0} simulated tool calls`,detail:'See action receipts below',status:'complete'},
    {stage:'Validate',summary:record?.validation?.passed?'All acceptance checks passed':'Inspect acceptance checks',detail:record?.validation?.checks,status:record?.validation?.passed?'passed':'failed'},
    {stage:'Adapt',summary:record?.adaptation,detail:'Future cycles use the realized state',status:'complete'}
  ];
}
function isFailed(status) {return /fail|reject|error|critical|rolled.?back/i.test(String(status || ''));}

function renderPreview(record) {
  const stages=getStages(record);
  $('#stage-preview').innerHTML=stageLabels.map((label,i)=>{
    const stage=stages[i] || {};
    return `<div class="stage-node ${isFailed(stage.status)?'failed':''}"><span class="stage-number">${isFailed(stage.status)?'!':'✓'}</span><strong>${label}</strong><small>${esc(stage.status || 'complete')}</small></div>`;
  }).join('');
  const objective=objectives.find(o=>o.id===record?.plan?.objective)?.label || record?.plan?.objective || 'Balanced';
  $('#decision-heading').textContent=`${objective} dispatch · cycle ${num(record?.tick)+1}`;
  const unserved=num(record?.dispatch?.shedMW);
  $('.decision-callout').classList.toggle('service-alert',unserved>0.005);
  $('#decision-summary').textContent=(record?.plan?.summary || 'Inspect the completed planning record.')+(unserved>0.005?` Constraints respected, but ${fmt(unserved,2)} MW demand is unserved. Inspect the risks and service trade-offs.`:'');
}

function renderAgent(record) {
  if (!record) return;
  const stages=getStages(record);
  $('#stage-trace').innerHTML=stages.map((s,i)=>{
    let evidence=detail(s.detail);
    if(i===0){const o=record.observation || {};evidence+=`\nSolar ${fmt(o.solarMW)} MW · wind ${fmt(o.windMW)} MW · demand ${fmt(o.demandMW)} MW\nBuy ${money(o.buyPrice)}/MWh · sell ${money(o.sellPrice)}/MWh · grid cap ${fmt(o.gridLimitMW)} MW\nCarbon price ${money(o.carbonPriceINRPerTonne)}/t · demand response ${money(o.demandResponseIncentiveINRPerMWh)}/MWh\nFrequency ${fmt(num(o.gridFrequencyHz,50),2)} Hz (illustrative proxy) · cloud ${fmt(o.weather?.cloudCoverPct,0)}% · wind ${fmt(o.weather?.windSpeedMS)} m/s\n${o.consumers?.length || 0} consumers · ${o.gridLines?.length || 0} grid lines · ${o.maintenanceSchedule?.length || 0} maintenance jobs\nModeled forecast uncertainty ${fmt(num(o.uncertaintyPct)*100,0)}%.`}
    if(i===1){const a=record.analysis || {};evidence+=`\nRequested objective: ${a.requestedObjective || record.plan?.objective}. Effective objective: ${a.effectiveObjective || record.plan?.objective}.\n${a.reserveRationale || ''}\n${(a.risks || []).join('; ') || 'No elevated risks identified in this observation.'}\n${a.criteriaDescription || ''}`}
    if(i===2){evidence+=`\n${record.plan?.method || 'Bounded candidate search.'}\n${num(record.plan?.horizonMinutes,120)}-minute horizon · lower modeled score ranks better. A new decision is made after 15 minutes.`}
    const modelDetails=i===1 && record.analysis?.weights?`<details class="model-details"><summary>Inspect objective weights & scoring</summary><pre>${esc(detail({weights:record.analysis.weights,executedTickScoreComponents:record.analysis.scoreComponents,scope:record.analysis.scoreScope}))}</pre></details>`:'';
    return `<div class="trace-step ${isFailed(s.status)?'failed':''}"><span class="stage-number">${String(i+1).padStart(2,'0')}</span><div><div class="trace-step-heading"><strong>${esc(stageLabels[i] || s.stage)}</strong><small>${esc(s.status || 'complete')}</small></div><p>${esc(detail(s.summary))}</p>${evidence?`<div class="trace-detail">${esc(evidence)}</div>`:''}${modelDetails}</div></div>`;
  }).join('');
  const alternatives=Array.isArray(record.alternatives)?record.alternatives:[];
  $('#plan-alternatives').innerHTML=alternatives.slice(0,5).map((p,i)=>`<div class="plan-option ${i===0?'selected':''}"><span class="plan-rank">${i+1}</span><div><strong>${esc(p.label || p.summary || `Candidate ${i+1}`)}</strong><small>${money(p.cost)} modeled horizon cost · ${fmt(p.chargeMW)} MW charge / ${fmt(p.dischargeMW)} MW discharge</small></div><span class="plan-score">${fmt(p.score,2)}<small>LOWER IS BETTER</small></span></div>`).join('') || '<div class="empty-state">No alternative candidates returned.</div>';
  const checks=record.validation?.checks || [];
  $('#validation-checks').innerHTML=checks.map(c=>`<div class="check-row ${c.passed===false?'failed':''}"><span class="check-icon">${c.passed===false?'!':'✓'}</span><div><strong>${esc(c.name)}</strong><small>${esc(detail(c.detail))}</small></div></div>`).join('') || '<div class="empty-state">No checks returned.</div>';
  const executions=record.execution || [];
  $('#execution-audit').innerHTML=`<div class="audit-overflow"><table class="audit-table"><thead><tr><th>TOOL</th><th>ARGUMENTS</th><th>STATUS</th><th>RECEIPT</th></tr></thead><tbody>${executions.map(e=>`<tr><td>${esc(e.tool)}</td><td><code>${esc(detail(e.args))}</code></td><td><span class="receipt-badge ${isFailed(e.status)?'failed':''}">${esc(e.status || 'recorded')}</span></td><td>${esc(detail(e.detail))}</td></tr>`).join('') || '<tr><td colspan="4">No tool calls recorded.</td></tr>'}</tbody></table></div>`;
}

function renderScenarios(snapshot) {
  const scenarioIcons={balanced:'☀',cloud:'☁',price:'↗',outage:'▯',congestion:'⌁',storm:'⛈',windSurge:'↑',frequency:'∿',forecast:'◷',maintenance:'⚒'};
  $('#scenario-cards').innerHTML=scenarios.map(s=>`<button class="scenario-card ${s.id===snapshot.scenario?'selected':''}" data-scenario="${esc(s.id)}" aria-pressed="${s.id===snapshot.scenario}"><span class="scenario-icon" aria-hidden="true">${scenarioIcons[s.id] || '✦'}</span>${s.id===snapshot.scenario?'<span class="scenario-selected">● ACTIVE</span>':''}<strong>${esc(s.label)}</strong><p>${esc(s.description)}</p></button>`).join('');
  const activeEvents=(snapshot.events || []).filter(event=>snapshot.tick>=event.tick && snapshot.tick<event.expiresTick);
  $('#event-state').textContent=injectedCount?`${injectedCount} event injection${injectedCount===1?'':'s'} · Latest: ${lastInjection}. ${activeEvents.length} active modeled event${activeEvents.length===1?'':'s'}.`:'No event injections yet. Choose an event, then run a cycle to observe its effect.';
}

function render() {
  const snapshot=simulation.snapshot();
  const records=simulation.history || [];
  const last=records.at(-1);
  const inspected=records.find(r=>r.tick===selectedTick) || last;
  latestAggregate=simulation.aggregate();
  $('#simulation-time').textContent=last?.time || snapshot.time || '—';
  $('#cycle-label').textContent=`Cycle ${String(records.length).padStart(2,'0')} · 15-minute steps`;
  $('#active-scenario-label').textContent=scenarios.find(s=>s.id===snapshot.scenario)?.label || snapshot.scenario;
  $('#objective-select').value=snapshot.objective;
  $('#log-count').textContent=String(records.length);
  const select=$('#cycle-select');
  select.innerHTML=records.slice(-192).reverse().map(r=>`<option value="${num(r.tick)}">${esc(r.time)} · Cycle ${num(r.tick)+1}</option>`).join('');
  if(inspected) select.value=String(inspected.tick);
  renderKpis(latestAggregate,records);
  renderChart(records);
  renderBalance(last);
  renderBatteries(last?.batteries || snapshot.batteries);
  renderPortfolio(last,snapshot);
  renderInputEditor(snapshot);
  renderPreview(last);
  renderAgent(inspected);
  renderScenarios(snapshot);
  const running=dayRunning || !!autoTimer;
  $('#run-status').classList.toggle('running',running);
  $('#run-status').innerHTML=`<span></span> ${dayRunning?'Running 24 h':autoTimer?'Running':'Paused'}`;
  $('#run-cycle').disabled=dayRunning;
  $('#auto-toggle').disabled=dayRunning;
  $('#run-day').textContent=dayRunning?'Pause 24-hour run':'Run 24 hours ↗';
}

function stopAuto() {if(autoTimer) clearInterval(autoTimer); autoTimer=null; $('#auto-toggle').checked=false;}
function runCycle(quiet=false) {
  try {
    const scenario=simulation.snapshot().scenario;
    const record=simulation.cycle();
    record.scenario=scenario;
    if(simulation.history.length) simulation.history.at(-1).scenario=scenario;
    selectedTick=record.tick;
    render();
    const serviceShortfall=num(record.dispatch?.shedMW)>0.005;
    if(!quiet || serviceShortfall!==serviceAlertActive){
      const outcome=serviceShortfall?`Constraints respected; ${fmt(record.dispatch.shedMW,2)} MW demand is unserved. Inspect the risks and service trade-offs.`:record.validation?.passed?'Demand fully served; operating constraints respected.':'Review the validation and action receipts.';
      announce(`Cycle ${num(record.tick)+1} complete at ${record.time}. ${outcome}`,serviceShortfall);
    }
    serviceAlertActive=serviceShortfall;
    return record;
  } catch(error) {stopAuto();dayRunning=false;dayToken++;render();announce(`Simulation could not complete this cycle: ${error.message}. Reset to restart.`,true);return null;}
}

async function runDay() {
  if(dayRunning) {dayToken++; dayRunning=false; render(); announce('24-hour run paused. Completed cycles and metrics are retained.'); return;}
  stopAuto(); dayRunning=true; const token=++dayToken; let count=0; render();
  announce('Running 96 simulated 15-minute intervals. You can pause at any time.');
  while(count<96 && dayRunning && token===dayToken) {
    const batchEnd=Math.min(count+2,96);
    while(count<batchEnd && dayRunning && token===dayToken) {if(!runCycle(true)) return;count++;}
    announce(`24-hour simulation: ${count} / 96 intervals complete.`);
    await new Promise(resolve=>setTimeout(resolve,24));
  }
  if(token!==dayToken) return;
  dayRunning=false;render();
  announce(`24-hour simulation complete. ${fmt(latestAggregate.reliabilityPercent,1)}% demand served; ${fmt(num(latestAggregate.pendingShiftMWh),2)} MWh shifted demand still pending. Inspect the results or export the run.`);
}

function download(filename,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement('a'); anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJSON() {
  const report={platform:'GridPilot',version:'2.0',scope:'All physical operations simulated. Synthetic forecasts and prices; frequency is an illustrative planning proxy. Consumers, line flows, maintenance and health are simplified models.',seed:42,stepMinutes:15,currency:'INR',priceUnit:'INR/MWh',baseline:'No storage, same scheduled demand and synthetic telemetry; service levels and pending shifted demand may differ.',aggregate:simulation.aggregate(),snapshot:simulation.snapshot(),records:simulation.history};
  download(`gridpilot-run-${simulation.history.length}-cycles.json`,JSON.stringify(report,null,2),'application/json');
  announce('JSON report downloaded with cycle evidence, tool receipts, and cumulative metrics.');
}
function exportCSV() {
  const headers=['cycle','time','scenario','objective','solar_MW','wind_MW','demand_MW','charge_MW','discharge_MW','import_MW','export_MW','curtail_MW','solar_curtail_MW','wind_curtail_MW','flex_MW','unserved_MW','pending_shift_MWh','observed_frequency_Hz','frequency_proxy_after_Hz','carbon_price_INR_per_tonne','DR_incentive_INR_per_MWh','cost_INR','baseline_cost_INR','carbon_kg','baseline_carbon_kg','served_MWh','unserved_MWh','validated'];
  const csvCell=v=>`"${String(v ?? '').replace(/"/g,'""')}"`;
  const rows=simulation.history.map(r=>{const d=r.dispatch||{}, o=r.observation||{};return [num(r.tick)+1,r.time,r.scenario || o.scenario || simulation.snapshot().scenario,r.plan?.objective,d.solarMW,d.windMW,d.demandMW,d.chargeMW,d.dischargeMW,d.importMW,d.exportMW,d.curtailMW,d.solarCurtailMW,d.windCurtailMW,d.flexMW,d.shedMW,d.backlogMWh,o.gridFrequencyHz,d.frequencyAfterHz,o.carbonPriceINRPerTonne,o.demandResponseIncentiveINRPerMWh,r.metrics?.cost,r.baseline?.cost,r.metrics?.carbonKg,r.baseline?.carbonKg,r.metrics?.servedMWh,r.metrics?.unservedMWh,r.validation?.passed].map(csvCell).join(',');});
  download(`gridpilot-dispatch-${simulation.history.length}-cycles.csv`,[headers.join(','),...rows].join('\r\n'),'text/csv;charset=utf-8');
  announce('CSV report downloaded with interval dispatch, costs, emissions, service and validation results.');
}

async function initialize() {
  try {
    const engine=await import('./engine.js');
    scenarios=engine.SCENARIOS || [];objectives=engine.OBJECTIVES || [];
    simulation=new engine.EnergySimulation({seed:42,scenario:'balanced',objective:'balanced'});
    $('#objective-select').innerHTML=objectives.map(o=>`<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    $('#event-buttons').innerHTML=eventTypes.map(e=>`<button class="event-button" data-event="${e.id}"><span aria-hidden="true">${e.icon}</span><div><strong>${e.label}</strong><small>${e.description}</small></div></button>`).join('');
    document.addEventListener('click',event=>{
      const viewButton=event.target.closest('[data-view]');if(viewButton) switchView(viewButton.dataset.view);
      const scenarioButton=event.target.closest('[data-scenario]');if(scenarioButton){simulation.configure({scenario:scenarioButton.dataset.scenario});render();announce(`${scenarios.find(s=>s.id===scenarioButton.dataset.scenario)?.label || 'Scenario'} selected for the next cycle. Existing totals are retained.`);}
      const eventButton=event.target.closest('[data-event]');if(eventButton){simulation.injectEvent(eventButton.dataset.event);injectedCount++;lastInjection=eventTypes.find(e=>e.id===eventButton.dataset.event)?.label || 'Event';render();announce(`${lastInjection} injected. Run the next cycle to inspect the agent’s response.`);}
    });
    $('.brand').addEventListener('click',event=>{event.preventDefault();switchView('overview');});
    $('#objective-select').addEventListener('change',event=>{simulation.configure({objective:event.target.value});render();announce('Objective updated for the next decision. A storm or large frequency-proxy deviation can temporarily prioritize reliability.');});
    $('#input-form').addEventListener('input',()=>{inputDirty=true;$('#input-feedback').textContent='Unapplied changes. Apply inputs to use these values for upcoming decisions.';});
    $('#input-form').addEventListener('submit',event=>{
      event.preventDefault();
      try {
        const inputs=Object.fromEntries([...new FormData(event.currentTarget).entries()].map(([key,value])=>[key,Number(value)]));
        simulation.configure({inputs});inputDirty=false;inputSyncPending=true;render();
        $('#input-feedback').textContent='Manual inputs applied. Run a cycle to inspect the resulting dispatch. Previous cycle evidence is retained.';
        announce('Simulated inputs applied to upcoming cycles. Run a cycle to observe the response.');
      } catch(error) {$('#input-feedback').textContent=`Inputs could not be applied: ${error.message}`;announce('Review the simulated input values.',true);}
    });
    $('#restore-inputs').addEventListener('click',()=>{simulation.configure({inputs:null});inputDirty=false;inputSyncPending=true;render();$('#input-feedback').textContent='Synthetic time-varying profiles restored. Event injections and history are retained.';announce('Synthetic input profiles restored for upcoming cycles.');});
    $('#cycle-select').addEventListener('change',event=>{selectedTick=Number(event.target.value);renderAgent(simulation.history.find(r=>r.tick===selectedTick));announce(`Inspecting cycle ${selectedTick+1}. Live overview continues to show the latest dispatch.`);});
    $('#run-cycle').addEventListener('click',()=>runCycle());
    $('#auto-toggle').addEventListener('change',event=>{if(event.target.checked){stopAuto();$('#auto-toggle').checked=true;autoTimer=setInterval(()=>runCycle(true),1500);render();announce('Autonomous operation started. One simulated interval runs every 1.5 seconds.');}else{stopAuto();render();announce('Autonomous operation paused. The current state is retained.');}});
    $('#run-day').addEventListener('click',runDay);
    $('#reset').addEventListener('click',()=>{stopAuto();dayToken++;dayRunning=false;simulation=new engine.EnergySimulation({seed:42,scenario:'balanced',objective:'balanced'});injectedCount=0;lastInjection='';selectedTick=null;serviceAlertActive=false;inputDirty=false;inputSyncPending=true;$('#input-feedback').textContent='Inputs affect upcoming cycles; completed evidence is retained.';runCycle(true);announce('Simulation reset to the same seed. First dispatch complete; paused and ready to explore.');});
    $('#export-json').addEventListener('click',exportJSON);$('#export-csv').addEventListener('click',exportCSV);
    $('#print-report').addEventListener('click',()=>{stopAuto();dayToken++;dayRunning=false;render();window.print();announce('Print view includes the overview and inspected cycle evidence.');});
    window.addEventListener('hashchange',()=>switchView(location.hash.slice(1) || 'overview'));
    window.addEventListener('resize',()=>{if(simulation) renderChart(simulation.history);});
    switchView(titles[location.hash.slice(1)]?location.hash.slice(1):'overview');
    runCycle(true);
  } catch(error) {
    $$('#run-cycle,#run-day,#reset,#auto-toggle,#objective-select,#export-json,#export-csv,#print-report').forEach(control=>control.disabled=true);
    const banner=document.createElement('div');banner.className='error-banner';banner.textContent=`GridPilot could not load the local simulation engine: ${error.message}. Start the included local launcher and open its browser address; ES modules require an HTTP server.`;$('#view-overview').prepend(banner);
    announce('Simulation engine unavailable. No dispatch results have been generated.',true);
  }
}
initialize();
