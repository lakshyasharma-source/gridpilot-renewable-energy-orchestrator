# GridPilot - Submission Checklist

Selected challenge: **Problem 4 - Utilities: Renewable Energy Orchestrator**.

GridPilot coordinates eight renewable assets, two batteries, three consumers and two grid links in a repeatable 15-minute simulation. It observes, analyzes, plans, executes simulated tools, validates and adapts. Market, weather, maintenance, demand and asset changes are visible in decisions and receipts.

## Deliverables and access

| Deliverable | Material / final action |
|---|---|
| Working prototype | `dist/` application; launch instructions in `README.md`. Private hosting may require ChatGPT sign-in: confirm reviewer access. |
| GitHub repository URL | Publish source to an accessible repository and verify it. A hosted app or ZIP does not replace the portal's requested repository URL. Publication must be confirmed separately. |
| Pitch deck | Seven-page `GridPilot_Pitch.pdf`, reflecting the final implementation. |
| Demo video | `GridPilot_Demo.mp4`: an edited, captioned walkthrough of actual UI captures, without voice audio. Verify two-to-four-minute duration and playback; optional narration follows `DEMO_SCRIPT.md`. |
| Structural architecture | `ARCHITECTURE.md`: process, state, model, decisions, tools, recovery, assumptions and limits. |
| Coverage and checks | `REQUIREMENTS_COVERAGE.md`, `VALIDATION.md`, `VALIDATION_RESULTS.json`. Regenerate checks/results after changes. |
| Grid declaration | Proposed F3 / D1, justified below by the evidence actually demonstrated. |

The supplied screenshot requests repository URL, PDF/PowerPoint deck and a two-to-four-minute video. The brief requires a working demo, architecture and justified grid assessment. Verify the portal's current fields, limits and deadline before uploading.

## Proposed F3 / D1 declaration

| Level | Evidence and qualification |
|---|---|
| F1: coordinated actions | Storage, market, source curtailment, consumer flexibility and maintenance policy. Best explored feasible dispatch; no global optimality proof. |
| F2: criteria and uncertainty | Four profiles, storm/frequency overrides, forecast-uncertainty reserves, visible weights/risks/alternatives. Show a before/after decision. |
| F3: changing situations over time | Fresh 96-cycle evaluations, evolving assets/load ledgers/maintenance, manual inputs and shocks. |
| D1: structured inputs and demonstrated decisions | Independently checked dispatch, replay, accounting/deadline and recovery evidence; disclose scenario boundaries. |

**D2 is not claimed by default.** Passing simplified-model checks does not establish high real-world reliability. **D3 is not claimed:** no heterogeneous multimodal input pipeline. The brief gives qualitative levels without a numerical D2 accuracy threshold. Match the final claim to the working evidence; both over- and underestimation can be penalized.

## Evidence to show

- One complete observe/analyze/plan/execute/validate/adapt cycle.
- Requested/effective objectives, alternatives and score scope.
- Carbon price, incentive and weather inputs affecting decisions.
- Named consumer service, critical-load priority and conserved deferral.
- Individual line limits, solar/wind curtailment and battery health/availability.
- Maintenance decisions reflected in forecast availability; simulated inspection receipts.
- Rejected tool, rollback, replacement plan and exactly one commit.
- Day simulation, qualified baseline and exported evidence.

The final submitted code passed **27 tests** and a separate **993/993-cycle** validator evaluation. These checks establish model consistency, not full service in every scenario: congestion/storm runs retain shortfalls. Quote outcomes from actual runs and identify scenario, seed, cycle count, pending work and starting/final SOC.

The no-storage baseline shares the agent's schedule, shift compensation and incentive revenue; it isolates storage rather than independently testing demand response. Costs include initial storage, exclude capital and terminal-inventory cash value, and cannot establish annual savings, full profit or payback.

## Honest scope statement

GridPilot is a browser-based agent using bounded model-based planning over synthetic conditions. Equipment, trades, maintenance and inspections are simulated. No connected LLM, trained forecast, live market or hardware is used. Farms expose individual output/availability but planning aggregates generation. Links use transport limits without AC power flow or electrical frequency dynamics. Frequency and health are illustrative; battery nameplate capacity stays fixed. Source selection compares curtailment charges rather than lifecycle cleanliness. Maintenance uses a bounded policy. No operational certification or global optimality guarantee is claimed.

## Suggested submission description

GridPilot coordinates five solar farms, three wind farms, two batteries, three industrial consumers and two grid links every simulated 15 minutes. It selects priorities, adjusts reserves, plans over two hours and executes independently validated simulated transactions. Carbon prices, demand incentives, weather, source curtailment and maintenance affect dispatch. Named load ledgers protect critical demand and conserve deferred energy. Injected failure demonstrates rollback, replanning and atomic recovery. Time simulation and exported evidence support a conservative F3/D1 scope, with synthetic forecasts, simplified transport/frequency/health and bounded optimality disclosed.

## Final review

1. Run tests and regenerate validation for submitted source.
2. Verify documented launch instructions and demo playback.
3. Verify deck, architecture and coverage match the final code.
4. Confirm repository publication and judge access.
5. Confirm the video is two-to-four minutes and legible.
6. Upload repository URL, deck and video, plus architecture/claim as permitted.
7. Verify portal confirmation. Preparation alone is not submission.
