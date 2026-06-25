# substrate

The floor every other component stands on. **Clock + Space + Event Bus.**

- **Responsibility:** provide the single authoritative `now()` (wall/monotonic/
  logical), the scheduler (`at`/`every`/`after`/`deadline`), the space address
  trees, and the event bus that carries `(space, time)` events.
- **Membrane:** everyone subscribes here; nothing keeps its own timer.
- **Must be:** restart-safe, sleep/suspend-aware, single-flight on `every()`,
  UTC-internal, explicit missed-fire policy.
- **States:** see `../../docs/STATES.md` (Fact TTL transitions use the wall clock;
  schedules persist next-fire times).
- **Open:** O3 (missed-fire policy), O4 (cross-node skew convention).

> Build order: **this is built first** — Surface/Conductor/etc. depend on it.
