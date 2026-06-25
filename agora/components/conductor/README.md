# conductor

The orchestration layer — decides what runs, where, when, and what preempts what.

- **Responsibility:** consume triggers (time + condition) from the bus; spawn /
  stop / preempt Workers; enforce the concurrency model (single / consecutive-
  override / multi-thread parallel); own the **task registry** and **per-host
  mutexes**.
- **Membrane (invariant):** the **only** thing that starts/stops/preempts a Worker.
- **Triggers it consumes:** all of them; it is the router from event → action.
- **States:** owns Task (`queued→planning→acting→…`) and the Host lock FSM
  (`free→locked→busy→…`) — see `../../docs/STATES.md`.
- **Open:** O5 (one container or split into trigger-eval vs dispatch — lean: one at L0).
