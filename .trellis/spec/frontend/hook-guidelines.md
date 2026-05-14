# Hook Guidelines

## Overview

The frontend currently uses built-in React hooks directly inside feature components. There are no custom hooks yet. Keep state local until the same stateful workflow is repeated or a component becomes hard to read.

Server state is fetched through `endpoints` in `src/client/api.ts`. Live-ish dashboard and history screens use polling with cleanup in `useEffect`; the project does not use React Query, SWR, WebSockets, or global client state.

## Custom Hook Patterns

Create a custom hook only when it removes repeated stateful logic from multiple components. A new hook should:

- Use the `useX` naming convention.
- Accept typed arguments instead of reading globals directly.
- Return a typed object or tuple with stable names.
- Keep API calls routed through `endpoints`.
- Keep cleanup logic inside the hook if it creates timers or subscriptions.

Do not extract one-off form state into a hook just to reduce line count.

## Data Fetching

Fetch data from components with `useEffect` and endpoint wrappers. Keep the current state visible while polling refreshes unless a user-initiated action fails and needs an explicit message.

```tsx
useEffect(() => {
  const load = () => endpoints.dashboard().then(setData);
  void load();
  const timer = setInterval(load, 5000);
  return () => clearInterval(timer);
}, []);
```

For query-driven lists, build `URLSearchParams` near the component state that owns the filters.

```tsx
const params = new URLSearchParams({ page: String(filters.page), pageSize: "20" });
if (filters.q) params.set("q", filters.q);
setRuns(await endpoints.runs(params));
```

## Local State

Use `useState` for form values, filters, active views, drawer state, and action messages. Use `useRef` for timer IDs or mutable browser handles that should not trigger a re-render.

```tsx
const [message, setMessage] = useState("");
const keyCopyMessageTimer = useRef<number | null>(null);

useEffect(() => {
  return () => {
    if (keyCopyMessageTimer.current !== null) {
      window.clearTimeout(keyCopyMessageTimer.current);
    }
  };
}, []);
```

## Scenario: Polling Hook Extraction

### 1. Scope / Trigger
- Trigger: Two or more screens need the same polling lifecycle, loading state, and error handling.

### 2. Signatures
- Suggested shape: `usePollingResource<T>({ load, intervalMs })`.
- `load` should call a function from `endpoints`.

### 3. Contracts
- Timer cleanup is mandatory.
- Polling interval should remain explicit at the call site.
- User-initiated action errors should still render near the triggering form/action.

### 4. Validation & Error Matrix
- Poll request fails during background refresh -> retain prior data.
- Component unmounts -> clear timer.
- Filter state changes -> rebuild params and refresh from page 1 when appropriate.

### 5. Good/Base/Bad Cases
- Good: extract repeated polling once both dashboard and history need identical lifecycle logic.
- Base: keep a single screen's polling inline in its component.
- Bad: add React Query or a global store for the MVP polling use case.

### 6. Tests Required
- Type-check every hook extraction.
- Add tests when a hook contains branching behavior beyond timer cleanup and simple state assignment.

### 7. Wrong vs Correct

#### Wrong
```tsx
useEffect(() => {
  setInterval(() => endpoints.runs(params).then(setRuns), 5000);
}, [filters]);
```

#### Correct
```tsx
useEffect(() => {
  void load();
  const timer = setInterval(load, 5000);
  return () => clearInterval(timer);
}, [filters]);
```

## Common Mistakes

- Forgetting to clear polling timers in `useEffect`.
- Calling `fetch` directly instead of using `endpoints`.
- Storing simple form state globally.
- Hiding API failures from user-initiated actions.
- Extracting hooks before a repeated pattern exists.
