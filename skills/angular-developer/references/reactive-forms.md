# Reactive forms

Reactive forms define controls in TypeScript, expose changes through observables, and provide synchronous access to form values.

## Core classes

Reactive forms are built using these fundamental classes from `@angular/forms`:

- `FormControl`: Manages the value and validity of an individual input.
- `FormGroup`: Manages a group of controls (an object-like structure).
- `FormArray`: Manages a numerically indexed array of controls.
- `FormBuilder`/`NonNullableFormBuilder`: A service that provides factory methods for creating control instances.

## Setup

Import `ReactiveFormsModule` into your component.

```ts
import { Component, inject } from "@angular/core";
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from "@angular/forms";

@Component({
  selector: "app-profile-editor",
  imports: [ReactiveFormsModule],
  templateUrl: "./profile-editor.component.html",
})
export class ProfileEditor {
  private readonly fb = inject(NonNullableFormBuilder);

  // Using FormBuilder for concise definition
  protected readonly profileForm = this.fb.group({
    firstName: ["", Validators.required],
    lastName: "",
    address: this.fb.group({
      street: "",
      city: "",
    }),
    aliases: this.fb.array([this.fb.control("")]),
  });

  protected onSubmit() {
    console.warn(this.profileForm.value);
  }
}
```

## Template binding

Use directives to bind the model to the view:

- `[formGroup]`: Binds a `FormGroup` to a `<form>` or `<div>`.
- `formControlName`: Binds a named control within a group to an input.
- `formGroupName`: Binds a nested `FormGroup`.
- `formArrayName`: Binds a nested `FormArray`.
- `[formControl]`: Binds a standalone `FormControl`.

```html
<form [formGroup]="profileForm" (ngSubmit)="onSubmit()">
  <input type="text" formControlName="firstName" />

  <div formGroupName="address">
    <input type="text" formControlName="street" />
  </div>

  <div formArrayName="aliases">
    @for (alias of profileForm.controls.aliases.controls; track alias) {
    <input type="text" [formControlName]="$index" />
    }
  </div>

  <button type="submit" [disabled]="!profileForm.valid">Submit</button>
</form>
```

## Accessing controls

Use `.controls` for easy access to controls.

```ts
addAlias() {
  this.profileForm.controls.aliases.push(this.fb.control(''));
}
```

## Updating values

- `patchValue()`: Updates only the specified properties. Fails silently on structural mismatches.
- `setValue()`: Replaces the entire model. Strictly enforces the form structure.

```ts
updateProfile() {
  this.profileForm.patchValue({
    firstName: 'Nancy',
    address: { street: '123 Drew Street' }
  });
}
```

## Unified change events

Modern Angular (v18+) provides a single `events` observable on all controls to track value, status, pristine, touched, reset, and submit events.

```ts
import { ValueChangeEvent, StatusChangeEvent } from "@angular/forms";

this.profileForm.events.subscribe((event) => {
  if (event instanceof ValueChangeEvent) {
    console.log("New value:", event.value);
  }
});
```

## Manual state management

- `markAsTouched()` / `markAllAsTouched()`: Useful for showing validation errors on submit.
- `markAsDirty()` / `markAsPristine()`: Tracks if the value has been modified.
- `updateValueAndValidity()`: Manually triggers recalculation of value and status.
- Options `{ emitEvent: false }` or `{ onlySelf: true }` can be passed to most methods to control propagation.
