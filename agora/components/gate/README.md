# gate (Growth Gate)

Human-gated learning — the **only** durable-memory writer.

- **Responsibility:** when a thread resolves, run the **distiller** (context-
  injected with intent + episode + existing skills/facts/findings), emit a
  **promotion report** (each item: route + why + confidence + on-approve action),
  route to **skill / fact-index / finding / reference / drop**, and on human
  approval write Brain.
- **Membrane (invariant):** proposes only; never auto-writes. Behavior-changing
  skills are always flagged for eyes first. Default route = drop.
- **Triggers:** `idle ≥ N` | `/wrap` | resolved-condition (per Thread/Case FSM).
- **States:** Promotion-item FSM (`pending→discuss→approved→committed | rejected |
  superseded`) — see `../../docs/STATES.md`.
- **Open:** O2 (writer scope), O6 (promotion threshold), O8 (codename).

See a worked example report in `BLUEPRINT.md §5` and the earlier Ethernet/undock cases.
