# Glossary sidebar

A pinned, collapsible, filterable term list beside a document with many specialist terms.

This pattern is proposed upstream as
[anthropics/claude-code#90263](https://github.com/anthropics/claude-code/issues/90263)
and documented here for use now.

## When to use it

Use this pattern for a reference or explainer with approximately 15 or more domain terms
a reader may not know. Examples include protocol comparisons, architecture decision
records, incident post-mortems, migration guides, spec summaries, and onboarding docs.

Use inline definitions instead for a short memo, a dashboard, or a page with only a few
specialist terms. Avoid adding a glossary where it is unnecessary.

## Why use a sidebar

| Approach                       | Problem                                                 |
| ------------------------------ | ------------------------------------------------------- |
| Inline definition at each use  | Repeats the definition at every occurrence              |
| Glossary section at the bottom | Makes readers leave their scroll position               |
| `<abbr title>` / tooltips      | No touch support, not searchable, invisible until hover |
| `<details>` after each term    | Interrupts reading                                      |

## 1. Only the main column scrolls

Above approximately 1040px, the page uses a fixed-height two-column layout. Scrolling
through the body does not move the glossary. Below that width, the sidebar stacks
underneath as a normal section. Never use a floating overlay on mobile.

```css
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--aside-w, 22rem);
  /* Without this the row is content-sized, the main column has no constrained
     height, and nothing can scroll inside it. */
  grid-template-rows: minmax(0, 1fr);
}

@media (min-width: 1040px) {
  body {
    overflow: hidden;
  }

  /* 100vh, not a height:100% chain — the host does not guarantee html/body height. */
  .plate {
    height: 100vh;
    padding-block: 0;
  }
  .layout {
    height: 100%;
  }

  .col-main {
    min-height: 0; /* grid/flex default of auto refuses to shrink */
    overflow-y: auto;
    overscroll-behavior: contain; /* end of column does not scroll the host page */
  }
}
```

The layout requires `grid-template-rows: minmax(0,1fr)`, `min-height: 0` on the scrolling
child, and `100vh` on the wrapper. Omitting any one can prevent scrolling or make the
whole viewport scroll.

## 2. Collapsible

The sidebar collapses to a vertical rail approximately 3rem wide, leaving more room for
wide diagrams.

```css
.layout[data-aside="closed"] {
  --aside-w: 3rem;
}
.layout[data-aside="closed"] .aside-inner {
  display: none;
}
.layout[data-aside="open"] .rail {
  display: none;
}
```

```js
function setAside(state, moveFocus) {
  layout.dataset.aside = state;
  const open = state === "open";
  railOpen.setAttribute("aria-expanded", String(open));
  glossCollapse.setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem("glossary-aside", state);
  } catch {
    /* private window or blocked site data — the default is fine */
  }
  if (moveFocus) {
    const target = open ? glossCollapse : railOpen;
    // offsetParent is null below the breakpoint, where neither control is shown
    if (target.offsetParent !== null) target.focus();
  }
}
```

## 3. Searchable and filterable

Store terms as data and render them with one function. Provide a text filter, category
chips, and a live count.

```js
const TERMS = [
  ["code_verifier", "pkce", "A high-entropy random string the client keeps to itself…"],
  ["device_code", "device", "The client's opaque polling handle…"],
  ["Refresh token", "both", "A longer-lived credential exchanged for new access tokens…"],
];

function renderGlossary() {
  const q = search.value.trim().toLowerCase();
  const shown = TERMS.filter(([term, tag, def]) => {
    if (activeTag !== "all" && tag !== activeTag) return false;
    return !q || (term + " " + def).toLowerCase().includes(q);
  });
  count.textContent = `${shown.length} of ${TERMS.length}`;
}
```

Use categories that help readers interpret terms. In a comparison document,
`pkce` / `device` / `both` identify which protocol a term applies to. Match chip colors
to the accent colors used in the body.

## Accessibility

- Set `aria-expanded` and `aria-controls` on both the collapse button and the rail.
- Move focus to the visible control. Check `offsetParent` first.
- Set `aria-pressed` on filter chips.
- Use `<dl>` / `<dt>` / `<dd>` for the term list.
- Use `<input type="search">` with an `aria-label`.

## Theming

Define chip and tag accents on bare `:root` and in both theme blocks. A glossary has
many small colored labels, so an incomplete dark palette is especially visible.
`validate.mjs` catches missing base token definitions.
