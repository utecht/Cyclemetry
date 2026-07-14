// Window dragging is ours to implement: the window uses titleBarStyle "Overlay"
// with a hidden title, so there is no native title bar to grab — the app header
// stands in for one and calls startDragging() on mousedown.
//
// Modal backdrops are `fixed inset-0`, so while one is open it covers the header
// and swallows that mousedown, leaving the window pinned in place. Modals put a
// WindowDragStrip over the title bar band to hand dragging back.

import { getCurrentWindow } from '@tauri-apps/api/window'

function isInteractiveTarget(target) {
  return target.closest(
    'button, input, a, select, textarea, [role="button"], [role="slider"]',
  )
}

/** Drag the window by this element; double-click to zoom, like a title bar. */
export function windowDrag(node) {
  function onMousedown(e) {
    if (e.button !== 0 || e.detail > 1) return
    if (isInteractiveTarget(e.target)) return
    getCurrentWindow().startDragging()
  }

  function onDblclick(e) {
    if (e.button !== 0) return
    if (isInteractiveTarget(e.target)) return
    getCurrentWindow().toggleMaximize()
  }

  node.addEventListener('mousedown', onMousedown)
  node.addEventListener('dblclick', onDblclick)

  return {
    destroy() {
      node.removeEventListener('mousedown', onMousedown)
      node.removeEventListener('dblclick', onDblclick)
    },
  }
}
