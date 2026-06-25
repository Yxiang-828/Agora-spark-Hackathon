# brain

The memory — knowledge held in tiers.

- **Responsibility:** store and serve **episodic** (thread), **semantic index**
  (facts/schemas w/ TTL + provenance), **procedural** (skills), and **archive**
  (findings = verdicts; reference = stable docs).
- **Membrane (invariant):** **read-only to everything except the Growth Gate.**
  Workers read for context injection; only the Gate writes durable tiers.
- **Triggers:** facts carry TTL → re-verify `every(Δ)`; non-decaying facts never
  auto-refresh; episodic archived by age.
- **States:** Fact FSM (`fresh→stale→reverifying→…`) and Skill FSM
  (`draft→proposed→active→deprecated`) — see `../../docs/STATES.md`.
- **Open:** O2 (episodic write ownership), O6 (skill threshold), O7 (cross-thread sharing).
