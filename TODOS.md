# TODOS

## Later

- [ ] **Overlay trim ears.** Add draggable left/right handles on the bottom timeline bar to set `scene.start` and `scene.end` without typing in the sidebar. The ears bracket the overlay window within the full activity range, similar to the distance-reference dot. Left ear → `scene.start`, right ear → `scene.end`; dragging either should keep the sidebar inputs in sync.

- [ ] **Aspect-ratio template variants.** Non-16:9 output now retargets the
  canvas and uniformly height-scales the authored template, so elements
  authored for 16:9 can fall off the sides on portrait/square (accepted for
  now). Future: let community templates ship per-aspect-ratio layout variants
  (e.g. 16:9 / 9:16 / 1:1) and pick the closest variant for the chosen output.

- [ ] **Composite elements.** Composites are groups with a curated, simpler editor panel — expose only high-level controls (position, metric, color scheme) rather than every sub-element property. The composite panel should feel simpler than the sum of its parts; "Expand to elements" is the non-destructive escape hatch for full control. Data model is already in place via `scene.editor.groups`; needs a `composite: true` flag per group + a composite-specific properties panel in the editor.

- [ ] **Scene-level color variables.** Define named colors once in `scene.vars` (e.g. `"accent": "#eed105"`) and reference them in any element color field as `"$accent"`. A Rust pre-pass resolves variable references before rendering. Editor gets a vars panel for bulk recolor. Composites can expose scene vars as their "color scheme" control, making the two features complementary.

- [ ] **Shimano Di2 gear metric.** Parse Di2 gear data from Garmin FIT files and expose it as a `gear` metric for value elements and shift-event visualization. **Start here:** determine whether the current Rust FIT parser pulls through Garmin developer fields (`front_gear`, `rear_gear`, `gear_change_data`) or silently drops them.

- [ ] **Element properties audit.** (1) Fix basic/advanced property categorization — some properties are in the wrong tier. (2) Audit per-element property sets for anything irrelevant to that element type. (3) Remove text-related controls (font, italic, text_align, etc.) from elements that don't render text.
