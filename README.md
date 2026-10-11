# GridPilot

GridPilot is a working simulation for **Problem 4: Utilities - Renewable Energy Orchestrator** in the ET AI Hackathon, Agentic Edition. Every simulated 15 minutes it coordinates five solar farms, three wind farms, two batteries, three industrial consumers and two grid interconnections.

The agent observes conditions, analyzes objectives and risks, plans across a two-hour forecast, executes simulated tools, validates the dispatch and adapts to new observations or tool failures. Its decision intelligence is model-based planning with bounded beam search. All equipment operations, trades, maintenance and inspection dispatches are simulated.

## Run locally

Serve `dist/` over HTTP; browser ES modules cannot run by opening the HTML file directly. With Node.js 20 or newer:

```sh
npm start
```

Open `http://127.0.0.1:4173`. Alternatively, use Python:

```sh
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. Use `python3` if that is your installed command. The application and Node launcher have no third-party runtime dependencies and need no API key.

Run the checks and regenerate recorded scenario results with:

```sh
npm test
npm run evaluate
```

The submitted version passed **27 tests**, including 2,592 seeded scenario intervals and 384 mixed-shock intervals plus focused feature/recovery cases. A separate evaluator validated **993 of 993 committed cycles**. Exact results are in [VALIDATION.md](docs/VALIDATION.md) and [VALIDATION_RESULTS.json](docs/VALIDATION_RESULTS.json). Passing accounting checks does not mean all demand was served: constrained congestion and storm scenarios have substantial shortfalls. Re-run both commands after changing the model; tests verify this simulation, not real-world grid reliability.

## What works

- Eight renewable assets expose individual output variations and maintenance availability. Planning combines their output into solar and wind totals.
- Battery A is 12 MWh / 8 MW; Battery B is 8 MWh / 5 MW. Each tracks SOC, availability, efficiency, throughput and illustrative health. Charge and discharge efficiency are both 0.92, giving 84.64% round-trip efficiency.
- Steel works, a cold-storage plant and an assembly factory expose critical/flexible demand. Named consumer ledgers preserve deferred energy and its repayment deadline; noncritical demand is exhausted before critical demand is shed.
- Two parallel transport links expose individual import/export limits and flows. They are simplified transfer capacities, rather than an electrical network model.
- Solar and wind curtailment are separate candidate choices with source-specific simulated charges.
- Energy prices, carbon prices, demand-response incentive revenue, degradation, shift compensation and curtailment charges enter modeled operating cost.
- Weather updates and uncertainty change forecast inputs and reserve headroom. Storms and large frequency-proxy excursions temporarily prioritize reliability.
- Frequency response is explicitly illustrative: it supplies a measurable planning signal without claiming to model electrical stability.
- Maintenance can be scheduled or delayed within a bounded window. Staged delays change future availability before dispatch planning; storm inspections create simulated receipts.
- Tools use idempotency keys, staged execution, independent validation and one atomic commit. A failed battery command rolls back and triggers replanning.

## Demonstrate the agent

1. Run a cycle and inspect all six stages in **Agent activity**, including alternatives, weights, checks and receipts.
2. In **Scenarios**, adjust carbon price, demand incentives, cloud cover, wind speed or frequency proxy. Apply and run a cycle. Manual values stay fixed until **Restore synthetic** is selected.
3. Inject clouds, a wind surge, a price spike, demand surge, battery outage, grid restriction, forecast update, storm, maintenance request or tool failure.
4. Inspect consumers, line flows, battery health, maintenance and separate solar/wind curtailment in **Overview**.
5. Use **Run 24 hours** to append 96 intervals. The interface performs one initial cycle on load/reset, so a fresh-dashboard day run contains 97 total records. History survives scenario changes.
6. Export JSON for complete evidence or CSV for interval metrics.

The private [hosted prototype](https://gridpilot-energy-lab.cleanflint8.chatgpt.site/) may require ChatGPT sign-in. A hosted link does not replace the repository URL requested by the portal; confirm judge access before submission.

## Scope and comparison limits

This is a bounded model-based agent with synthetic forecasts. It has no connected LLM, trained forecasting model, live market feed or equipment connection. It does not guarantee a global optimum or certify real operations. Generation is aggregated for planning; grid links use transport limits with no AC power flow, voltage or frequency dynamics. Battery health is a throughput ledger with fixed nameplate capacity/power, rather than a calibrated aging model. Both renewables use zero modeled operational emissions; source selection reflects availability and curtailment charges rather than lifecycle cleanliness.

The no-storage baseline adopts the agent's exact shifted/restored schedule and the same shift compensation and incentive revenue. It isolates storage rather than independently evaluating flexibility. Comparisons include 12 MWh initial stored energy and different final SOC, exclude capital cost and do not value ending inventory. They cannot establish annual savings, full profit or payback. Compare delivered service, critical shortfalls and pending load beside cost. Renewable utilization includes exports and battery charging.

## Submission claim and materials

The proposed assessment remains **F3 / D1**, subject to the submitted evidence. F3 reflects simulation over time with changing inputs; F2 reflects situation-dependent objectives and uncertainty headroom; F1 reflects coordinated feasible action selection. D2 requires defensible reliability evidence beyond passing simplified-model tests. D3 is not claimed.

- [Requirements coverage and simplifications](docs/REQUIREMENTS_COVERAGE.md)
- [Detailed structural architecture](docs/ARCHITECTURE.md)
- [Two-to-four-minute demo script](docs/DEMO_SCRIPT.md)
- [Submission checklist and justification](docs/SUBMISSION.md)
- [Seven-page pitch PDF](docs/GridPilot_Pitch.pdf)
- [Captioned demo video](docs/GridPilot_Demo.mp4)
- [Recorded validation](docs/VALIDATION.md) and [exact results](docs/VALIDATION_RESULTS.json)

The supplied portal screenshot requests a GitHub repository URL, a PDF or PowerPoint deck, and a two-to-four-minute demo video. Confirm repository publication, video playback, judge access and the portal's current fields/deadline before submitting.

The included video is an edited, captioned walkthrough of actual application captures, without a voice soundtrack. It is not presented as an uninterrupted screen recording. Optional narration can follow the script; verify the portal's accepted format and duration.
