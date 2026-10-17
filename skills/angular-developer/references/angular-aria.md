# Angular Aria

Angular Aria (`@angular/aria`) is a collection of headless, accessible directives that implement common WAI-ARIA patterns. These directives handle keyboard interactions, ARIA attributes, focus management, and screen reader support.

Provide the HTML structure and CSS. The directives handle accessibility behavior.

## Styling headless components

Because Angular Aria components are headless, they do not come with default styles. You **must** use CSS to style different states based on the ARIA attributes or structural classes the directives automatically apply.

Common ARIA attributes to target in CSS:

- `[aria-expanded="true"]` / `[aria-expanded="false"]`
- `[aria-selected="true"]`
- `[aria-disabled="true"]`
- `[aria-current="page"]` (for navigation)

---

Check that `@angular/aria` is installed before using it. If needed, run `npm install @angular/aria`.

## 1. Accordion

Organizes related content into expandable/collapsible sections.

Use an accordion for FAQs, long forms, or content readers can expand one section at a time. Avoid it for primary navigation or content readers need to compare across sections.

**Imports:** `import { AccordionContent, AccordionGroup, AccordionPanel, AccordionTrigger } from '@angular/aria/accordion';`

**Directives:** `ngAccordionGroup`, `ngAccordionTrigger`, `ngAccordionPanel`, `ngAccordionContent` (for lazy loading).

```ts
@Component({
  selector: "app-cmp",
  imports: [AccordionContent, AccordionGroup, AccordionPanel, AccordionTrigger],
  template: `...`,
  styles: [],
})
export class App {
  protected readonly title = signal("angular-app");
}
```

```html
<div ngAccordionGroup [multiExpandable]="false">
  <div class="accordion-item">
    <button ngAccordionTrigger [panel]="panel1" class="accordion-header">
      Section 1
      <span class="icon">▼</span>
    </button>
    <div ngAccordionPanel #panel1="ngAccordionPanel" class="accordion-panel">
      <ng-template ngAccordionContent>
        <p>Lazy loaded content here.</p>
      </ng-template>
    </div>
  </div>
</div>
```

**Styling Strategy:**
Target the `[aria-expanded]` attribute on the trigger to rotate icons, and style the panel visibility.

```css
.accordion-header[aria-expanded="true"] .icon {
  transform: rotate(180deg);
}

/* The panel directive handles DOM removal, but you can style the transition */
.accordion-panel {
  padding: 1rem;
  border-top: 1px solid #ccc;
}
```

---

## 2. Listbox

Displays a visible list of selectable options, not a dropdown.

**Usage:** Visible selectable lists (single or multi-select).

**Imports:** `import {Listbox, Option} from '@angular/aria/listbox';`

**Directives:** `ngListbox`, `ngOption`.

```ts
@Component({
  selector: "app-cmp",
  imports: [Listbox, Option],
  template: `...`,
  styles: [],
})
export class App {
  protected readonly title = signal("angular-app");
}
```

```html
<!-- horizontal or vertical orientation -->
<ul ngListbox [(value)]="selectedItems" orientation="horizontal" [multi]="true">
  <li ngOption value="apple" class="option">Apple</li>
  <li ngOption value="banana" class="option">Banana</li>
</ul>
```

**Styling Strategy:**
Target `[aria-selected="true"]` for selected state and `:focus-visible` or `[data-active]` for the focused item (Angular Aria uses roving tabindex or activedescendant).

```css
.option {
  padding: 8px;
  cursor: pointer;
}
.option[aria-selected="true"] {
  background: #e0f7fa;
  font-weight: bold;
}
/* Focus state managed by aria */
.option:focus-visible {
  outline: 2px solid blue;
}
```

---

## 3. Combobox, select, and multiselect

These patterns combine the `ngCombobox` directive (applied directly to the trigger/combobox element) with a popup containing an `ngListbox` widget.

- **Combobox (Autocomplete)**: Applied to an `<input ngCombobox>` element. Ideal when typing filters the list.
- **Select**: Applied to a focusable wrapper like a `<div ngCombobox>` or `<button ngCombobox>` element. Users select from a list of options.
- **Multiselect**: A Combobox or Select paired with a multi-select `ngListbox`.

**Imports:**

```ts
import { Combobox, ComboboxPopup, ComboboxWidget } from "@angular/aria/combobox";
import { Listbox, Option } from "@angular/aria/listbox";
```

**Directives:** `ngCombobox`, `ngComboboxPopup`, `ngComboboxWidget`, `ngListbox`, `ngOption`.

```html
<!-- Example 1: Standard Autocomplete -->
<div>
  <input
    ngCombobox
    #combobox="ngCombobox"
    [(value)]="searchString"
    [(expanded)]="isExpanded"
    placeholder="Search options..."
    class="select-trigger"
  />

  <ng-template ngComboboxPopup [combobox]="combobox">
    <ul
      ngComboboxWidget
      ngListbox
      #listbox="ngListbox"
      [(value)]="selectedValue"
      [activeDescendant]="listbox.activeDescendant()"
      class="dropdown-menu"
    >
      <li ngOption value="option1" label="Option 1" class="option">Option 1</li>
      <li ngOption value="option2" label="Option 2" class="option">Option 2</li>
    </ul>
  </ng-template>
</div>

<!-- Example 2: Select Component (Applied directly to a div trigger) -->
<div ngCombobox #select="ngCombobox" [(expanded)]="selectExpanded" class="select-trigger">
  <span class="select-text">{{ selectedValue() ?? 'Choose an option' }}</span>
  <span class="icon">▼</span>
</div>

<ng-template ngComboboxPopup [combobox]="select">
  <ul
    ngComboboxWidget
    ngListbox
    #selectListbox="ngListbox"
    [(value)]="selectedValues"
    [activeDescendant]="selectListbox.activeDescendant()"
    (click)="onCommit()"
    (keydown.enter)="onCommit()"
    class="dropdown-menu"
  >
    <li ngOption value="option1" label="Option 1" class="option">Option 1</li>
    <li ngOption value="option2" label="Option 2" class="option">Option 2</li>
  </ul>
</ng-template>
```

**Styling Strategy:**
Style the popup container to look like a dropdown floating above content (often paired with CDK Overlay).

```css
.select-trigger {
  width: 200px;
  padding: 8px;
  text-align: left;
}
.dropdown-menu {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid #ccc;
  background: white;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

---

## 4. Menu and menubar

For actions, commands, and context menus (not for form selection).

Use a menubar for desktop-style command categories such as File, Edit, and View, with horizontal keyboard navigation. Avoid it for standalone action lists or mobile layouts with limited width.

**Imports:** `import {MenuBar, Menu, MenuContent, MenuItem, MenuTrigger} from '@angular/aria/menu';`

**Directives:** `ngMenuBar`, `ngMenu`, `ngMenuItem`, `ngMenuTrigger`, `ngMenuContent`.

```html
<!-- Menubar Example -->
<div ngMenuBar class="menubar">
  <div ngMenuItem value="file" [submenu]="fileMenu" class="menubar-item">File</div>
  <div ngMenuItem value="edit" [submenu]="editMenu" class="menubar-item">Edit</div>
</div>

<div ngMenu #fileMenu="ngMenu" class="menu">
  <ng-template ngMenuContent>
    <div ngMenuItem value="new">New</div>
    <div ngMenuItem value="open">Open</div>
  </ng-template>
</div>

<div ngMenu #editMenu="ngMenu" class="menu">
  <ng-template ngMenuContent>
    <div ngMenuItem value="cut">Cut</div>
    <div ngMenuItem value="copy">Copy</div>
  </ng-template>
</div>
```

**Styling Strategy:**
Use flexbox for the menubar. Hide/show submenus based on the trigger's state.

```css
.menubar {
  display: flex;
  gap: 10px;
  list-style: none;
  padding: 0;
}
.menu {
  background: white;
  border: 1px solid #ccc;
  padding: 5px 0;
}
.menu li {
  padding: 5px 15px;
  cursor: pointer;
}
```

---

## 5. Tabs

Layered content sections where only one panel is visible.

Use tabs for settings panels, documentation topics, or dashboard views within one page. Avoid them for sequential workflows or more than seven or eight sections.

**Imports:** `import {Tab, Tabs, TabList, TabPanel, TabContent} from '@angular/aria/tabs';`

**Directives:** `ngTabs`, `ngTabList`, `ngTab`, `ngTabPanel`, `ngTabContent`.

```html
<div ngTabs>
  <ul ngTabList [(selectedTab)]="selectedTabValue" class="tab-list">
    <li ngTab value="profile" class="tab-btn">Profile</li>
    <li ngTab value="security" class="tab-btn">Security</li>
  </ul>

  <div ngTabPanel value="profile" class="tab-panel">
    <ng-template ngTabContent>Profile Settings</ng-template>
  </div>
  <div ngTabPanel value="security" class="tab-panel">
    <ng-template ngTabContent>Security Settings</ng-template>
  </div>
</div>
```

**Styling Strategy:**
Target `[aria-selected="true"]` on the tab buttons.

```css
.tab-list {
  display: flex;
  border-bottom: 2px solid #ccc;
  list-style: none;
  padding: 0;
}
.tab-btn {
  padding: 10px 20px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab-btn[aria-selected="true"] {
  border-bottom-color: blue;
  font-weight: bold;
}
.tab-panel {
  padding: 20px;
}
```

---

## 6. Toolbar

Groups related controls (like text formatting).

Use a toolbar for related controls, such as text formatting or media playback. Arrow keys move focus between controls.

**Imports:** `import {Toolbar, ToolbarWidget, ToolbarWidgetGroup} from '@angular/aria/toolbar';`

**Directives:** `ngToolbar`, `ngToolbarWidget`, `ngToolbarWidgetGroup`.

```html
<div ngToolbar class="toolbar">
  <div ngToolbarWidgetGroup [multi]="true" role="group" aria-label="Formatting">
    <button ngToolbarWidget value="bold" class="tool-btn">B</button>
    <button ngToolbarWidget value="italic" class="tool-btn">I</button>
  </div>
</div>
```

**Styling Strategy:**
Target `[aria-pressed="true"]` (for toggle buttons) or `[aria-checked="true"]` (for radio groups) within the toolbar.

```css
.toolbar {
  display: flex;
  gap: 5px;
  padding: 8px;
  background: #f5f5f5;
}
.tool-btn {
  padding: 5px 10px;
  border: 1px solid #ccc;
}
.tool-btn[aria-pressed="true"],
.tool-btn[aria-checked="true"] {
  background: #ddd;
}
```

---

## 7. Tree

Displays hierarchical data (file systems, nested nav).

Use a tree for nested data, such as files or an organization chart, where users expand and collapse branches. Avoid it for flat lists, tables, or simple selection menus.

**Imports:** `import {Tree, TreeItem, TreeItemGroup} from '@angular/aria/tree';`

**Directives:** `ngTree`, `ngTreeItem`, `ngTreeItemGroup`.

```html
<ul ngTree #tree="ngTree" [(value)]="selectedValues" class="tree">
  <li ngTreeItem [parent]="tree" value="documents" #docsItem="ngTreeItem">
    <span class="tree-label">Documents</span>
    <ul role="group">
      <ng-template ngTreeItemGroup [ownedBy]="docsItem" #docsGroup="ngTreeItemGroup">
        <li ngTreeItem [parent]="docsGroup" value="resume">Resume.pdf</li>
        <li ngTreeItem [parent]="docsGroup" value="cover-letter">CoverLetter.pdf</li>
      </ng-template>
    </ul>
  </li>
</ul>
```

**Styling Strategy:**
Target `[aria-expanded]` to show/hide children or rotate chevron icons. Use `padding-left` on nested groups to show hierarchy.

```css
.tree,
.tree-group {
  list-style: none;
  padding-left: 20px;
}
.tree-label::before {
  content: "▶ ";
  display: inline-block;
  transition: transform 0.2s;
}
li[aria-expanded="true"] > .tree-label::before {
  transform: rotate(90deg);
}
```

## 8. Grid

A two-dimensional interactive collection of cells enabling navigation via arrow keys.

**Usage:** Data tables, calendars, spreadsheets, and layout patterns for interactive elements.
**Directives:** `ngGrid`, `ngGridRow`, `ngGridCell`, `ngGridCellWidget`.

```html
<table ngGrid [multi]="true" [enableSelection]="true" class="grid-table">
  <tr ngGridRow>
    <th ngGridCell role="columnheader">Name</th>
    <th ngGridCell role="columnheader">Status</th>
  </tr>
  <tr ngGridRow>
    <td ngGridCell>Project A</td>
    <td ngGridCell [(selected)]="isSelected">
      <button ngGridCellWidget (activated)="onActivate()">Active</button>
    </td>
  </tr>
</table>
```

**Styling Strategy:**
Target `[aria-selected="true"]` for selected cells and `:focus-visible` for the active cell (roving tabindex) or `[aria-activedescendant]` on the container.

```css
.grid-table {
  border-collapse: collapse;
}
[ngGridCell] {
  padding: 8px;
  border: 1px solid #ddd;
}
[ngGridCell][aria-selected="true"] {
  background: #e3f2fd;
}
/* Focus state managed by roving tabindex */
[ngGridCell]:focus-visible {
  outline: 2px solid #2196f3;
  outline-offset: -2px;
}
```

## 9. Testing with component harnesses

Angular Aria provides component harnesses based on `@angular/cdk/testing`. Tests can use their methods instead of depending on internal DOM structure.

**Imports:**

```ts
import { HarnessLoader } from "@angular/cdk/testing";
import { TestbedHarnessEnvironment } from "@angular/cdk/testing/testbed";
import { AccordionGroupHarness, AccordionHarness } from "@angular/aria/accordion/testing";
import { ListboxHarness, ListboxOptionHarness } from "@angular/aria/listbox/testing";
```

### Example: testing an accordion with harnesses

```ts
describe("MyAccordionComponent", () => {
  let fixture: ComponentFixture<MyAccordionComponent>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    fixture = TestBed.createComponent(MyAccordionComponent);
    await fixture.whenStable();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  it("should expand accordion on toggle", async () => {
    // Get the harness by its trigger title
    const accordion = await loader.getHarness(AccordionHarness.with({ title: "Section 1" }));

    expect(await accordion.isExpanded()).toBeFalse();

    // Expand the accordion
    await accordion.expand();

    expect(await accordion.isExpanded()).toBeTrue();
  });
});
```

## 10. Integration with signal forms

Angular Aria directives use `model()` signals for interactive values and work with Signal Forms from `@angular/forms/signals`.

The `[formField]` directive automatically detects directives like `ngCombobox` or `ngListbox` as custom form controls because they expose a `value` model.

**Imports:**

```ts
import { form, schema, required } from "@angular/forms/signals";
import { Combobox, ComboboxPopup, ComboboxWidget } from "@angular/aria/combobox";
import { Listbox, Option } from "@angular/aria/listbox";
```

### Example 1: autocomplete combobox inside a form

Given a form model defined in your component:

```ts
protected readonly citySignal = signal({name: '', city: ''});
protected readonly myForm = form(this.citySignal, schema(f => {
  required(f.city);
}));
```

You bind it directly using `[formField]`:

```html
<div>
  <label for="city-input">Choose your city:</label>
  <input
    id="city-input"
    ngCombobox
    #combobox="ngCombobox"
    [formField]="myForm.city"
    [(expanded)]="isExpanded"
    placeholder="Search cities..."
  />

  <ng-template ngComboboxPopup [combobox]="combobox">
    <ul
      ngComboboxWidget
      ngListbox
      #listbox="ngListbox"
      [(value)]="selectedValue"
      [activeDescendant]="listbox.activeDescendant()"
      class="dropdown-menu"
    >
      <li ngOption value="sfo" label="San Francisco">San Francisco</li>
      <li ngOption value="nyc" label="New York">New York</li>
    </ul>
  </ng-template>
</div>
```

### Example 2: select component inside a form

Apply `ngCombobox` directly to a focusable `div` trigger and bind to `[formField]`:

```html
<div>
  <label for="city-select">Choose your city:</label>
  <div
    id="city-select"
    ngCombobox
    #select="ngCombobox"
    [formField]="myForm.city"
    [(expanded)]="isExpanded"
    class="select-trigger"
  >
    <span class="select-text">{{ myForm.city.value() || 'Choose your city' }}</span>
    <span class="icon">▼</span>
  </div>

  <ng-template ngComboboxPopup [combobox]="select">
    <ul
      ngComboboxWidget
      ngListbox
      #selectListbox="ngListbox"
      [(value)]="selectedValues"
      [activeDescendant]="selectListbox.activeDescendant()"
      (click)="onCommit()"
      (keydown.enter)="onCommit()"
      class="dropdown-menu"
    >
      <li ngOption value="sfo" label="San Francisco">San Francisco</li>
      <li ngOption value="nyc" label="New York">New York</li>
    </ul>
  </ng-template>
</div>
```

### Example 3: standalone listbox (multi-select) inside a form

You can bind a multi-selectable Listbox directly to a form array:

```html
<ul ngListbox [formField]="myForm.interests" [multi]="true" class="interest-list">
  <li ngOption value="sports">Sports</li>
  <li ngOption value="music">Music</li>
  <li ngOption value="tech">Technology</li>
</ul>
```

## General rules for agents

1. **Never use native HTML elements like `<select>`** when asked to implement these specific Aria patterns. Use the `ng*` directives.
2. Write CSS for the ARIA attributes that the directives toggle, such as `aria-expanded` and `aria-selected`. Angular Aria does not provide styles.
3. Lazy-render heavy panels and nested groups with the provided structural directives inside `ng-template`: `ngAccordionContent`, `ngTabContent`, `ngMenuContent`, `ngComboboxPopup`, and `ngTreeItemGroup`.
