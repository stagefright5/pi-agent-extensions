# Glossary sidebar

A pinned, collapsible, filterable term list beside a jargon-dense document.

Proposed upstream as [anthropics/claude-code#90263](https://github.com/anthropics/claude-code/issues/90263);
documented here so it is usable now.

## When to use it

A reference or explainer carrying **~15+ domain terms** a reader may not know:
protocol comparisons, architecture decision records, incident post-mortems, migration
guides, spec summaries, onboarding docs.

Not for a short memo, not for a dashboard, not for a page with five pieces of jargon —
inline definitions serve those better. Over-applying this is worse than not having it.

## Why not the obvious alternatives

| Approach                         | Problem                                                 |
| -------------------------------- | ------------------------------------------------------- |
| Inline parenthetical at each use | Repeats at every occurrence; bloats the prose           |
| Glossary section at the bottom   | Destroys scroll position — the actual problem           |
| `<abbr title>` / tooltips        | No touch support, not searchable, invisible until hover |
| `<details>` after each term      | Interrupts the reading flow                             |

## 1. Only the main column scrolls

Above ~1040px the page becomes a fixed-height two-column shell, so paging through the
body never moves the glossary. Below it, the aside stacks underneath as a normal
section — never a floating overlay on mobile.

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

Three requirements, any one of which silently produces a page where nothing scrolls or
the whole viewport scrolls: `grid-template-rows: minmax(0,1fr)`, `min-height: 0` on the
scrolling child, `100vh` on the wrapper.

## 2. Collapsible

Collapses to a ~3rem vertical rail so a wide diagram can reclaim the width.

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

Terms are data, rendered by one function. Text filter, category chips, live count.

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

Categories should carry meaning. In a comparison document `pkce` / `device` / `both`
tells the reader which half of the argument a term belongs to, and the chip colors tie
back to the accent colors used in the body.

## Accessibility

- `aria-expanded` + `aria-controls` on both the collapse button and the rail
- Focus moved to whichever control is now visible; check `offsetParent` first
- `aria-pressed` on filter chips
- `<dl>` / `<dt>` / `<dd>` for the term list
- `<input type="search">` with an `aria-label`

## Theming

Chip and tag accents need definitions on bare `:root` _and_ in both theme blocks. A
glossary is dense with small colored labels, so a partial dark palette shows up worst
here. `validate.mjs` catches the token half of this automatically.
