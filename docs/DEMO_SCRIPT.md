# GridPilot - Three-Minute Demo Script

Target length: **3:20**, within the two-to-four-minute window. Record the actual application. Read values from the screen; explain the chosen action even when it differs from your expectation. A price spike does not always justify discharging a depleted battery.

## Prepare

- Reset to normal operation; the interface runs one initial cycle.
- Rehearse inputs, events, failure receipts and export on submitted code.
- Keep evidence legible. These lines can be narration or captions.
- **Run 24 hours** appends 96 intervals, so a fresh dashboard produces 97 total records. Evaluator day results start fresh at 96.
- If you reset between chapters, label the new run and avoid comparing accumulated costs across the reset.

## 0:00-0:25 - Problem and portfolio

Show **Overview**, including the expanded portfolio panels.

> Renewable output, prices and demand change every 15 minutes. GridPilot coordinates five solar farms, three wind farms, two batteries, three industrial consumers and two grid links. Every equipment action, trade and maintenance operation is simulated.

Point to critical/flexible demand, battery availability and individual line limits.

## 0:25-0:55 - One autonomous decision

Click **Run cycle**, open **Agent activity**, then show stages, alternatives and checks.

> The agent observes, analyzes priorities, searches an eight-step forecast, executes simulated tools, validates constraints and adapts. Only the first 15-minute action executes before a new observation. Alternatives and weights make trade-offs visible.

> Its intelligence is bounded model-based planning, with no connected language model or trained forecast and no global optimality proof.

## 0:55-1:25 - Inputs affect decisions

In **Scenarios**, set carbon price to 20,000, incentive to 10,000, cloud cover to 80 and frequency near 50.00 Hz. Apply and run a cycle; show observed inputs and the actual resulting dispatch.

> Carbon charges, demand incentives and weather enter planning. Flexible work can be deferred, but its energy stays on the same consumer's ledger and must return within an hour. Critical loads receive priority. We inspect the actual response rather than assuming every input always changes every action.

Click **Restore synthetic** before event injections: manual values remain fixed and can mask injected cloud/wind/frequency changes.

## 1:25-1:55 - Changing conditions

Inject **Cloud cover** and **Price spike**, run a cycle, then inject **Battery outage** and run again. Show decisions and limits.

> Weather, tariffs and availability cause replanning. Cost, carbon, curtailment, reserves and service compete. If available capacity cannot supply demand, shortfalls remain visible, including any critical shortfall.

For a surplus example, use **Wind surge** in a fresh normal run and show actual charging, export or source curtailment.

## 1:55-2:25 - Maintenance and frequency scope

Inject **Maintenance due**, run a cycle and show its action/receipt. A **Storm alert** can demonstrate simulated inspection. Point briefly to frequency.

> A flexible job can be delayed within its permitted window; staged availability enters the forecast before dispatch planning. Storm inspections are simulated receipts. Frequency is an illustrative battery-response signal, not electrical grid stability.

If the job is scheduled instead of delayed, explain the action actually recorded.

## 2:25-2:55 - Failure and recovery

Inject **Tool failure**, run a cycle and show **Agent activity → Action receipt**.

> Battery B rejects a command. Prepared actions roll back, so no partial energy, market or maintenance update commits. The agent refreshes availability and maintenance risks, replans and validates a replacement. Receipts distinguish rejected and rolled-back attempts from one committed transaction; idempotency prevents duplicates.

Describe recovery as successful only if the record confirms it.

## 2:55-3:20 - Day, evidence and claim

Show a completed day or run **Run 24 hours** if rehearsal confirms the time. State whether totals include earlier demonstration cycles. Export JSON and end on **Architecture**.

> A day contains 96 intervals. The no-storage baseline shares the agent's shifted schedule and incentive accounting, isolating storage. Starting/final SOC, pending work and delivered service qualify cost comparisons. The proposed F3/D1 claim rests on changing-condition simulation, explicit criteria and independently checked structured decisions. Architecture, coverage, tests and audit document the assumptions.

The recording, repository and deck are materials. Confirm judge access and portal upload separately; a prepared package is not a submitted entry.
