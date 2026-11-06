# @stagefright5/pi-picker

## 0.2.1

### Patch Changes

- 426fdf0: Use semantic theme backgrounds in shared picker, popup, and composer surfaces instead of deriving dark-only colors. Keep job, plan, and side-agent statuses uncolored in Pi's persistent storage and apply the active theme when the shared footer renders, with plain fallbacks for other footers. Include the updated vendored UI libraries in consuming extensions.

## 0.2.0

### Minor Changes

- e6f91bf: Add `embedded` for pickers hosted in a frame that shows the title (such as a pi-dialog popup): the title and count row is skipped, small host heights are allowed, and `countLabel` exposes the count.

## 0.1.0

### Added

- Provide multi-word fuzzy search with word-start ranking, accent-insensitive matching, incremental narrowing, and asynchronous slices for large lists.
- Add highlighted lists, preview panes, filter chips, multi-select actions, and inline suggestion panels.
- Support fractional, content-fitting picker heights through `{ max, min, fit }`.
- Add `previewKey` for cached live-preview wrapping and `previewTail` for following new output.
- Bundle the picker privately into consuming extensions during package staging.

### Fixed

- Avoid repeatedly splitting preview text and computing match ranges for unchanged previews.
- Make filter controls discoverable with a `Ctrl+F` hint and numbered filter keys.
