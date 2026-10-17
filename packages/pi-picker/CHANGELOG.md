# @stagefright5/pi-picker

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
