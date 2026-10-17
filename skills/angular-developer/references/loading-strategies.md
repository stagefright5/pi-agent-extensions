# Route loading strategies

Angular supports two main strategies for loading routes and components to balance initial load time and navigation responsiveness.

## Eager loading

Components are bundled into the initial JavaScript payload and are available immediately.

```ts
{ path: 'home', component: Home }
```

Navigation needs no additional component download, but the initial bundle is larger.

## Lazy Loading

Components or routes are loaded only when the user navigates to them. This creates separate JavaScript "chunks".

### Lazy loading components

Use `loadComponent` to fetch the component on demand.

```ts
{
  path: 'admin',
  loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)`,
}
```

### Lazy loading child routes

Use `loadChildren` to fetch a set of routes.

```ts
{
  path: 'settings',
  loadChildren: () => import('./settings/settings.routes'),
}
```

## Injection context and lazy loading

Loader functions run within the **injection context** of the current route. This allows you to call `inject()` to make context-aware loading decisions.

```ts
{
  path: 'dashboard',
  loadComponent: () => {
    const flags = inject(FeatureFlags);
    return flags.isPremium
      ? import('./premium-dashboard')
      : import('./basic-dashboard');
  },
}
```

## Recommendation

- Use **Eager Loading** for the primary landing pages.
- Use **Lazy Loading** for all other feature areas to keep the initial bundle small.
