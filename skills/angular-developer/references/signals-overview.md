# Angular signals overview

A signal wraps a value and notifies consumers when it changes.

## Writable signals (`signal`)

Use `signal()` to create state that can be directly updated.

```ts
import { signal } from "@angular/core";

// Create a writable signal
const count = signal(0);

// Read the value (always requires calling the getter function)
console.log(count());

// Update the value directly
count.set(3);

// Update based on the previous value
count.update((value) => value + 1);
```

### Exposing as readonly

Expose a readonly signal from a service to prevent callers from changing it.

```ts
private readonly _count = signal(0);
// Consumers can read this, but cannot call .set() or .update()
readonly count = this._count.asReadonly();
```

## Computed signals (`computed`)

Use `computed()` to create read-only signals that derive their value from other signals.

- **Lazily Evaluated**: The derivation function doesn't run until the computed signal is read.
- **Memoized**: The result is cached. It only recalculates when one of the signals it depends on changes.
- **Dynamic Dependencies**: Only the signals _actually read_ during the derivation are tracked.

```ts
import { signal, computed } from "@angular/core";

const count = signal(0);
const doubleCount = computed(() => count() * 2);

// doubleCount automatically updates when count changes.
```

## Reactive contexts

A **reactive context** is a runtime state where Angular monitors signal reads to establish a dependency.

Angular automatically enters a reactive context when evaluating:

- `computed` signals
- `effect` callbacks
- `linkedSignal` computations
- Component templates

### Untracked reads (`untracked`)

If you need to read a signal inside a reactive context _without_ creating a dependency (so that the context doesn't re-run when the signal changes), use `untracked()`.

```ts
import { effect, untracked } from "@angular/core";

effect(() => {
  // This effect only runs when currentUser changes.
  // It does NOT run when counter changes, even though counter is read here.
  console.log(`User: ${currentUser()}, Count: ${untracked(counter)}`);
});
```

### Async operations in reactive contexts

The reactive context is only active for **synchronous** code. Signal reads after an `await` will not be tracked. **Always read signals before asynchronous boundaries.**

```ts
// ❌ INCORRECT: theme() is not tracked because it is read after await
effect(async () => {
  const data = await fetchUserData();
  console.log(theme());
});

// ✅ CORRECT: Read the signal before the await
effect(async () => {
  const currentTheme = theme();
  const data = await fetchUserData();
  console.log(currentTheme);
});
```
