# Fine-Grained Reactivity with `@preact/signals-react`

Status: **opt-in, whitelisted hotspots only** (ADR-0058).
Default state model in this codebase is still `useState` / `useReducer` / TanStack Query.

## When to use a signal

Use a signal **only** in one of the four whitelisted hotspots:

| Hotspot | Where | Why signals win |
|---|---|---|
| **H1 — cell grid** | `src/features/tables/components/UniversalTable/**` | Per-cell update without re-rendering the row/grid (Phase 4, deferred) |
| **H2 — Kanban DnD** | `src/features/widgets/components/presets/kanban/**` | Drag-position / hover / active-drag id without re-rendering siblings |
| **H3 — multiplayer presence** | `useMultiplayer*`, `VirtualOfficeWidget.tsx` | 50 cursors / live players without per-frame whole-widget re-render |
| **H4 — AI chat streaming** | `src/features/ai-chat/components/ChatMessages/ChatTurn/**` | Token-stream buffer doesn't moult neighbouring messages |

For **everything else** — modals, toolbars, forms, settings, routing, layout — use `useState`. Signals don't pay off there and just add a second mental model.

## How to use a signal

```tsx
import { useSignal } from '@preact/signals-react';

function KanbanCard({ id }: { id: string }) {
  // useSignal = signal scoped to this component instance
  const isHovering = useSignal(false);

  return (
    <div
      onMouseEnter={() => { isHovering.value = true; }}
      onMouseLeave={() => { isHovering.value = false; }}
      className={isHovering.value ? 'ring-2' : ''}
    >
      ...
    </div>
  );
}
```

- **Read** via `signal.value` inside JSX — the Babel transform (`@preact/signals-react-transform`, configured in `vite.config.ts`) auto-subscribes the component to the signals it reads.
- **Write** via `signal.value = next` — directly, no `setState`-style updater. Mutations are batched into a single microtask.
- For **shared** state (multiple components subscribe), hoist to a module-level `signal(...)` (not `useSignal`). Don't put one in component state and pass it through context for "everyone" — that defeats the purpose.

```ts
// module-level signal (e.g. kanban-signals.ts)
import { signal } from '@preact/signals-react';

export const activeDragCardId = signal<string | null>(null);
export const dragOverColumnId = signal<string | null>(null);
```

```tsx
// any component can read without prop drilling
import { activeDragCardId } from './kanban-signals';

function KanbanColumn() {
  const isHot = activeDragCardId.value !== null;
  ...
}
```

## WebSocket / `pg_notify` → signal

The push-update pattern is the cleanest signals win. Handler writes the signal, only subscribed cells / rows re-render.

```ts
// before — every WS message re-renders the whole grid via setState
socket.on('row:update', (row) => setRows(prev => prev.map(...)));

// after — only cells that actually read the changed value re-render
socket.on('row:update', (row) => {
  const cell = cellSignal(row.id, row.column);
  if (cell) cell.value = row.value;
});
```

For TanStack Query-backed data, prefer `queryClient.setQueryData` over a parallel signal store — don't fork the cache. Signals are for **transient UI state** (drag, hover, stream buffer, presence) and **fine-grained derived state**, not for replacing the server-state cache.

## How to measure

Before/after for any signals change, use the React DevTools profiler:

1. Open React DevTools → Profiler tab.
2. Press **Record**, perform the interaction (e.g. drag a card across 4 columns), press **Stop**.
3. Read **Commits**. The signals version should show ≥40% fewer commits for the targeted hotspot.

For bundle delta: run `npm run build` before and after the change, compare the `dist/assets/*.js` gzipped sizes. Target ≤ +5 KB gz net.

## Rules

- **Whitelisted hotspots only.** If you want signals somewhere else, open a discussion — don't sneak them in.
- **Don't mix `useState` and a signal for the same piece of state.** Pick one.
- **Don't write `signal.value` inside `useEffect` deps** — signals aren't reactive to the effect dependency-array. Use `effect()` from the package if you need an effect that runs when a signal changes.
- **Server state stays in TanStack Query.** Signals don't replace it.
- **No find-and-replace migration.** Each adoption is intentional, with profiler numbers in the PR.

## References

- ADR-0058 — Fine-Grained Reactivity (Signals) — Targeted Replacement Plan (`row:2197/151815`)
- Library: <https://github.com/preactjs/signals/tree/main/packages/react>
- Babel transform: <https://github.com/preactjs/signals/tree/main/packages/react-transform>
