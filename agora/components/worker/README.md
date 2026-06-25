# worker

Carries out **one** task: plan → act → observe → iterate.

- **Responsibility:** execute a single investigation/operation, checkpointed and
  resumable; pull context from Brain (read-only); act through Hands.
- **Membrane (invariant):** writes **no durable memory** (may write its own
  *episodic* case-file — pending O2). Interruptible only at checkpoints.
- **Clock:** runs on the **logical (step)** clock; checkpoints are the interrupt
  boundaries (the `iteration N/90` pattern, done right).
- **States:** Task FSM (`planning→acting→waiting→interrupted→…`) — see `../../docs/STATES.md`.
- **Open:** O2 (may a Worker write episodic live?).
