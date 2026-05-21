# TODOS

## Later

- [ ] **Overlay trim ears.** Add draggable left/right handles on the bottom timeline bar to set `scene.start` and `scene.end` without typing in the sidebar. The ears bracket the overlay window within the full activity range, similar to the distance-reference dot. Left ear → `scene.start`, right ear → `scene.end`; dragging either should keep the sidebar inputs in sync.

- [ ] **Aspect-ratio template variants.** Non-16:9 output now retargets the
  canvas and uniformly height-scales the authored template, so elements
  authored for 16:9 can fall off the sides on portrait/square (accepted for
  now). Future: let community templates ship per-aspect-ratio layout variants
  (e.g. 16:9 / 9:16 / 1:1) and pick the closest variant for the chosen output.

- [ ] **Composite elements.** A "composite" is a first-class UI concept that wraps a `scene.editor.groups` group behind a simpler interface. The user sees one thing (e.g. "Speed widget") instead of the 2–3 raw elements that make it up.
  - Composites ARE groups — no new data model needed on disk
  - The composite editor surface is **intentionally smaller than the sum of its parts** — exposes only high-level controls (position, metric, color scheme), not every sub-element property. If "Expand" feels like a power-user escape hatch, the abstraction level is right.
  - "Expand to elements" is non-destructive: removes the `composite` flag, group becomes a normal group, all elements become individually editable
  - **Implementation:** add `composite: true` (or `composite_type: "speed" | "custom"`) flag inside `scene.editor.groups[n]`; editor renders a compact composite panel instead of individual element rows
  - Bundled templates are already halfway there — aaron's `speed_group`, jeff's `power_group` etc. are existing groups that just need the flag
  - **Synergy with color variables:** composite panel can expose `scene.vars` as its "color scheme" controls

- [ ] **Scene-level color variables.** Templates often use the same 2–4 colors everywhere. Color variables let you define named colors once and reference them in any element color field.
  - **Proposed schema:**
    ```json
    { "scene": { "vars": { "accent": "#eed105", "text": "#ffffff", "bg": "#00000088" } },
      "elements": [{ "color": "$accent", "line": { "color": "$text" } }] }
    ```
  - **Resolution:** Rust pre-pass substitutes `"$varname"` strings before any rendering logic runs — zero cost to individual element renderers
  - **Editor:** color pickers on elements show the var name + resolved swatch; vars panel lives in scene settings (not per-element); editing a var propagates live
  - **Design decisions to make:**
    - Syntax: `"$accent"` vs `"var(--accent)"` vs `{ "$ref": "accent" }` — `"$accent"` is simplest for JSON readability
    - Fallback: undefined var → transparent/default color, or render error?
    - Scope: scene-level only, no element-level overrides — keep it simple

- [ ] **Shimano Di2 gear metric.** Parse Di2 electronic shifting data from Garmin FIT files and expose it as a `gear` metric for value elements and shift-event visualization.
  - **Start here (open question):** Does the current Rust FIT parser pull through Garmin developer fields, or silently drop them? Di2 data lives in developer fields (`front_gear`, `rear_gear`, `gear_change_data`) — if dropped today, that's the first fix.
  - Di2 also recorded in native FIT fields on some devices; some GPX exporters include it as extensions
  - Metric name candidates: `gear`, `front_gear`/`rear_gear`, `gear_ratio`
  - Display options: text (e.g. "34×28"), chainring/cassette icon, or shift-event markers on the course plot
  - **Affected layers:** FIT/GPX parser (Rust), metric enum/data pipeline, element types (`value` with `value: "gear"` should just work once in stream), template schema docs

- [ ] **Collapse `points:[{...}]` to `point:{...}`.** Every template uses a single-element `points` array on plot elements. Unless multi-point becomes a planned feature, this is nesting noise. Rename the field to `point` and make it an object, not an array. Needs: Rust schema change (`PlotConfig.points: Vec<PointConfig>` → `point: PointConfig`), `migrateConfig` to handle old `points[0]` on load, bundled template updates, and `stripDefaults` / `toEditorFormat` awareness.

- [ ] **Drop `natural_width`/`natural_height` from image elements.** These are captured at insert time and persisted, but are derivable from the image file at load time. Remove from the schema and resolve dimensions lazily in the Rust renderer via `imagesize` or equivalent. Currently present in aaron (1 image) and jeff (4 images).

- [ ] **Element properties audit.**
  1. **Basic vs. advanced categorization** — some properties are in the wrong bucket. Go through each element type and verify every property is correctly classified as basic (visible by default) or advanced (hidden behind toggle).
  2. **Per-element property sets** — some elements expose properties that don't apply to them. Remove anything that shouldn't be there.
  3. **Text properties on non-text elements** — some elements show text-related controls (font, italic, text_align, etc.) that are irrelevant to their type. Remove those panels/fields for element types that don't render text.
