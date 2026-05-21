# TODOS

## Later

- [ ] **Overlay trim ears.** Add draggable left/right handles on the bottom timeline bar to set `scene.start` and `scene.end` without typing in the sidebar. The ears bracket the overlay window within the full activity range, similar to the distance-reference dot. Left ear → `scene.start`, right ear → `scene.end`; dragging either should keep the sidebar inputs in sync.

- [ ] **Aspect-ratio template variants.** Non-16:9 output now retargets the
  canvas and uniformly height-scales the authored template, so elements
  authored for 16:9 can fall off the sides on portrait/square (accepted for
  now). Future: let community templates ship per-aspect-ratio layout variants
  (e.g. 16:9 / 9:16 / 1:1) and pick the closest variant for the chosen output.
