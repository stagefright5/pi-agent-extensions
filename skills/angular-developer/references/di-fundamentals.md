# Dependency injection (DI) fundamentals

Dependency injection lets components and services request shared values from Angular instead of creating those values themselves.

## How DI works in Angular

There are two primary ways code interacts with Angular's DI system:

1.  **Providing**: Making values (objects, functions, primitives) available to the DI system.
2.  **Injecting**: Asking the DI system for those values.

Angular components, directives, and services automatically participate in DI.

## Services

A **service** is the most common way to share data and functionality across an application. It is a TypeScript class decorated with `@Service()`.

### Creating a service

Use the `@Service()` decorator to make the service a singleton available throughout the entire application. This is the recommended approach for most services.

```ts
import { Service } from "@angular/core";

@Service()
export class AnalyticsLogger {
  trackEvent(category: string, value: string) {
    console.log("Analytics event logged:", { category, value });
  }
}
```

Common uses for services include:

- Data clients (API calls)
- State management
- Authentication and authorization
- Logging and error handling
- Utility functions

## Injecting dependencies

Use Angular's `inject()` function to request dependencies.

### The `inject()` function

You can use the `inject()` function to get an instance of a service (or any other provided token).

```ts
import { Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { AnalyticsLogger } from "./analytics-logger.service";

@Component({
  selector: "app-navbar",
  template: `<a href="#" (click)="navigateToDetail($event)">Detail Page</a>`,
})
export class Navbar {
  // Injecting dependencies using class field initializers
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsLogger);

  navigateToDetail(event: Event) {
    event.preventDefault();
    this.analytics.trackEvent("navigation", "/details");
    this.router.navigate(["/details"]);
  }
}
```

### Where can `inject()` be used? (injection context)

You can call `inject()` in an **injection context**. The most common injection contexts are during the construction of a component, directive, or service.

Valid places to call `inject()`:

1.  **Class field initializers** (Recommended)
2.  **Constructor body**
3.  **Route guards and resolvers** (which are executed in an injection context)
4.  **Factory functions** used in providers

```typescript
import { Component, Directive, Service, inject, ElementRef } from "@angular/core";
import { HttpClient } from "@angular/common/http";

// 1. In a Component (Field Initializer & Constructor)
@Component(/* ... */)
export class Example {
  private service1 = inject(MyService); // ✅ Field initializer

  private service2: MyService;
  constructor() {
    this.service2 = inject(MyService); // ✅ Constructor body
  }
}

// 2. In a Directive
@Directive({/*...*/})
export class MyDirective {
  private element = inject(ElementRef); // ✅ Field initializer
}

// 3. In a Service
@Service()
export class MyService {
  private http = inject(HttpClient); // ✅ Field initializer
}

// 4. In a Route Guard (Functional)
export const authGuard = () => {
  const auth = inject(AuthService); // ✅ Route Guard
  return auth.isAuthenticated();
};
```
