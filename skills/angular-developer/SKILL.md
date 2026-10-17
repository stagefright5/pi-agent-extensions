---
name: angular-developer
description: Generates Angular code and provides architectural guidance. Use for projects, components, services, reactivity, forms, dependency injection, routing, SSR, accessibility, animations, styling, testing, and CLI tooling.
license: MIT
metadata:
  author: Copyright 2026 Google LLC
  version: "1.0"
---

# Angular developer guidelines

1. Check the project's Angular version before giving guidance. APIs and recommended practices vary by version.
2. Follow Angular's style guide. Use the CLI to generate components, services, directives, pipes, and routing code.
3. After generating code, run `ng build` and fix build errors before proceeding. Do not skip this check.

## Creating projects

Follow the user's version request. Otherwise, use the installed CLI when available, or the latest stable CLI:

1. If the user requests a version, run `npx @angular/cli@<requested_version> new <project-name>`.
2. Otherwise, check `ng version`. If it succeeds, run `ng new <project-name>`.
3. If no CLI is installed, run `npx @angular/cli@latest new <project-name>`.

Use [signal forms](references/signal-forms.md) for new forms on Angular v21 or newer. For older projects and existing forms, follow the project's form strategy.

## Components

Read the reference for the task:

- [Components](references/components.md) covers metadata and template control flow with `@if`, `@for`, and `@switch`.
- [Inputs](references/inputs.md) covers signal inputs, transforms, and model inputs.
- [Outputs](references/outputs.md) covers custom events.
- [Host elements](references/host-elements.md) covers bindings and attribute injection.

For details not covered here, use the [Angular component guide](https://angular.dev/guide/components).

## Reactivity

Use Angular signals for reactive state:

- [Signals](references/signals-overview.md) covers `signal`, `computed`, reactive contexts, and `untracked`.
- [Dependent state](references/linked-signal.md) covers writable state linked to source signals with `linkedSignal`.
- [Async reactivity](references/resource.md) covers fetching data into signal state with `resource`.
- [Effects](references/effects.md) covers logging, third-party DOM updates with `afterRenderEffect`, and when not to use effects.

## Forms

- [Signal forms](references/signal-forms.md) is the default for new forms on Angular v21 or newer.
- [Template-driven forms](references/template-driven-forms.md) covers simple forms using that strategy.
- [Reactive forms](references/reactive-forms.md) covers complex forms using that strategy.

## Dependency injection

- [Fundamentals](references/di-fundamentals.md) covers services and `inject()`.
- [Creating services](references/creating-services.md) covers service declarations and injection into components or services.
- [Providers](references/defining-providers.md) covers `InjectionToken`, `useClass`, `useValue`, `useFactory`, and scopes.
- [Injection context](references/injection-context.md) covers where `inject()` is allowed, `runInInjectionContext`, and `assertInInjectionContext`.
- [Hierarchical injectors](references/hierarchical-injectors.md) covers `EnvironmentInjector`, `ElementInjector`, resolution modifiers, `providers`, and `viewProviders`.

## Accessibility

Read [Angular Aria](references/angular-aria.md) for accessible accordion, listbox, combobox, menu, tab, toolbar, tree, and grid components, including styling through ARIA attributes.

## Routing

- [Define routes](references/define-routes.md) covers paths, parameters, wildcards, and redirects.
- [Loading strategies](references/loading-strategies.md) covers eager, lazy, and context-aware loading.
- [Outlets](references/show-routes-with-outlets.md) covers `<router-outlet>`, nested outlets, and named outlets.
- [Navigation](references/navigate-to-routes.md) covers `RouterLink` and `Router`.
- [Guards](references/route-guards.md) covers route access with `CanActivate`, `CanMatch`, and related guards.
- [Resolvers](references/data-resolvers.md) covers fetching data before route activation with `ResolveFn`.
- [Router lifecycle](references/router-lifecycle.md) covers events and debugging.
- [Rendering strategies](references/rendering-strategies.md) covers CSR, SSG, and SSR with hydration.
- [Route animations](references/route-animations.md) covers the View Transitions API.

For more detail, use the [Angular routing guide](https://angular.dev/guide/routing).

## Styling and animations

- [Tailwind CSS](references/tailwind-css.md) covers Angular integration.
- [Animations](references/angular-animations.md) covers native CSS and the legacy DSL.
- [Component styling](references/component-styling.md) covers styles and encapsulation.

## Testing

- [Testing fundamentals](references/testing-fundamentals.md) covers Vitest, async tests, and `TestBed`.
- [Component harnesses](references/component-harnesses.md) covers component interaction in tests.
- [Router testing](references/router-testing.md) covers `RouterTestingHarness`.
- [End-to-end testing](references/e2e-testing.md) covers setup and execution.

## Tooling

- [Angular CLI](references/cli.md) covers creating, serving, and building projects and generating code.
- [Migrations](references/migrations.md) covers automated code updates.
- [MCP server](references/mcp.md) covers tools, configuration, and experimental options.
- [Environment configuration](references/environment-configuration.md) covers build-time and runtime settings.
