# hands

The effectors — how the agent touches the world. Cross-OS.

- **Responsibility:** exec on hosts, read files, vision, search; resolve transport
  per host-OS via `exec_on(host, cmd)` (Linux native / Windows → WSL or keys /
  ideally keys everywhere).
- **Membrane (invariant):** the **only** machine seam, and the **only** place
  credentials resolve — secrets never enter model context, posts, or logs.
- **Triggers:** invoked by a Worker; host-scoped; takes the host mutex for mutations.
- **Guards (blast radius):** read-only = no lock, free; mutation = lock + no
  auto-retry; high-blast (cuts the agent's own transport) = pre-check + confirm +
  auto-revert timer. See `BLUEPRINT.md §7`.
- **States:** participates in the Host lock FSM — see `../../docs/STATES.md`.
- **Open:** O4 (skew handling when ingesting foreign-clock data).
