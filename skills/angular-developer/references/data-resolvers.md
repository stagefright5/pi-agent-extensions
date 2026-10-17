# Data resolvers

Data resolvers fetch data before a route activates, so components have it when they render.

## Creating a resolver

Implement the `ResolveFn` type.

```ts
export const userResolver: ResolveFn<User> = (route, state) => {
  const userService = inject(UserService);
  const id = route.paramMap.get("id")!;
  return userService.getUser(id);
};
```

## Configuring the route

Add the resolver under the `resolve` key.

```ts
{
  path: 'user/:id',
  component: UserProfile,
  resolve: {
    user: userResolver
  }
}
```

## Accessing resolved data

### 1. Via `ActivatedRoute` (traditional)

```ts
private readonly route = inject(ActivatedRoute);
protected readonly data = toSignal(this.route.data);
protected readonly user = computed(() => this.data().user);
```

### 2. Via component inputs (modern)

Enable `withComponentInputBinding()` in `provideRouter` to pass resolved data directly to `@Input` or `input()`.

```ts
// app.config.ts
provideRouter(routes, withComponentInputBinding());

// component.ts
user = input.required<User>();
```

## Error handling

Navigation is blocked if a resolver fails.

- Use `withNavigationErrorHandler` for global handling.
- Use `catchError` within the resolver to return a `RedirectCommand` or fallback data.

```ts
return userService.get(id).pipe(catchError(() => of(new RedirectCommand(router.parseUrl("/error")))));
```

## Best practices

- Fetch only data needed to render the route.
- Show a loading bar using router events. The old page remains visible until the resolver finishes.
