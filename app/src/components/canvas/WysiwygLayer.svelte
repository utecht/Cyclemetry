<script>
  /**
   * Transparent SVG layer positioned over the canvas.
   *
   * Bounds strategy (two sources, merged per element):
   *   1. measuredElements — pixel-perfect Skia bounds returned by the Rust renderer.
   *      These are used whenever available (after the first frame loads).
   *   2. Config-derived fallback — used before the first frame is ready.
   *      Config `y` for text is the Skia baseline, so we subtract ~0.8×font_size
   *      to approximate the visual top of the glyph.
   */
  import { getContext, untrack } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import ElementHandle from './ElementHandle.svelte'

  const app = getContext('app')

  // Pixel-perfect bounds from the Rust renderer — { id, x, y, w, h }[]
  // frameImage: full rendered scene PNG (data URL) at output resolution.
  let { measuredElements = [], frameImage = null, zoom = 1 } = $props()

  // The backend renders + measures the demo frame at the chosen OUTPUT
  // resolution, scaled from the template's authored size by a uniform
  // height-based factor. The SVG overlay must use that same output space so
  // measured element bounds line up; config-derived fallbacks and drag
  // write-back are converted between authored ↔ output via `authorScale`.
  let sceneWidth = $derived(app.outputWidth ?? 1920)
  let sceneHeight = $derived(app.outputHeight ?? 1080)
  let authoredHeight = $derived(app.config?.scene?.height ?? 1080)
  let authorScale = $derived(sceneHeight / (authoredHeight || sceneHeight))

  function elById(id) {
    return app.config?.elements?.find((e) => e.id === id) ?? null
  }

  let elements = $derived.by(() => {
    if (!app.config?.elements) return []
    const measured = new Map(measuredElements.map(e => [e.id, e]))
    const s = authorScale
    // Config-derived fallback bounds are in authored coords; the rendered
    // image (and measured bounds) are in output coords — scale to match.
    const fb = (o) => ({ id: o.id, x: o.x * s, y: o.y * s, w: o.w * s, h: o.h * s })
    const byId = {}

    // Pick the best bounds source for a given element:
    //  • Dragging → use the pre-drag snapshot so dragDelta isn't double-counted.
    //  • Recently moved (stale measured) → skip measured, use config-derived.
    //  • Otherwise → prefer pixel-perfect measured, fall back to config-derived.
    function boundsFor(id) {
      if (liveResize?.id === id) return liveResize.bounds
      if (draggingIds.has(id)) return dragBase.baseElements.get(id) ?? null
      if (movedIds.has(id)) return null
      return measured.get(id) ?? null
    }

    for (const el of app.config.elements) {
      const id = el.id
      if (el.type === 'label') {
        const fs = el.font_size ?? 32
        const text = el.text ?? 'LABEL'
        byId[id] = boundsFor(id) ?? fb({
          id,
          x: el.x ?? 100,
          y: (el.y ?? 100) - fs * 0.8,           // baseline → visual top
          w: Math.max(text.length * fs * 0.58, fs),
          h: fs,
        })
      } else if (el.type === 'value') {
        const fs = el.font_size ?? 48
        byId[id] = boundsFor(id) ?? fb({
          id,
          x: el.x ?? 100,
          y: (el.y ?? 200) - fs * 0.8,
          w: fs * 3.5,
          h: fs,
        })
      } else if (el.type === 'plot' || el.type === 'meter' || el.type === 'gauge') {
        byId[id] = boundsFor(id) ?? fb({
          id,
          x: el.x ?? 50, y: el.y ?? 400,
          w: el.width ?? 400,
          h: el.height ?? 150,
        })
      } else if (el.type === 'rect' || el.type === 'image') {
        byId[id] = boundsFor(id) ?? fb({
          id,
          x: el.x ?? 100, y: el.y ?? 100,
          w: el.width ?? 300,
          h: el.height ?? 200,
        })
      }
    }
    return [...(app.elementLayerOrder ?? [])]
      .map((id) => byId[id])
      .filter(Boolean)
  })

  function handleLabel(id) {
    const el = elById(id)
    if (!el) return id
    if (el.type === 'label') return el.text ?? 'label'
    if (el.type === 'value') return el.value ?? 'value'
    if (el.type === 'meter') return `${el.value} meter`
    if (el.type === 'gauge') return `${el.value} gauge`
    if (el.type === 'rect') return 'rect'
    if (el.type === 'image') return el.file || 'image'
    return `${el.value} chart`
  }

  let selectedSet = $derived(new Set(app.selectedElementIds ?? []))
  // During a group drag: { leaderId, dx, dy }. Non-leader selected handles
  // follow via groupOffset so the whole selection moves in unison.
  let liveGroup = $state(null)

  // Live rotation state: { id, degrees } while the user is dragging the handle.
  let liveRotation = $state(null)

  // Live resize state: { id, bounds } while the user is dragging a resize corner.
  // Output-space bounds (x, y, w, h). Config is NOT mutated until release.
  let liveResize = $state(null)

  // Snapshot captured at drag start so live updates don't shift the base coords.
  // { preDragConfig: string, positions: Map<id,{category,idx,x,y}>, baseElements: Map<id,{x,y,w,h}> }
  let dragBase = $state(null)

  // Elements whose config position was just committed — skip stale measured
  // bounds for them until the next rendered frame arrives.
  let movedIds = $state(new Set())

  // Cropped pixels of the dragged element(s), floated under the cursor so the
  // real graphic moves during a drag (the box alone feels dead).
  // id → { url, baseX, baseY, x, y, w, h } — all output px.
  const dragSnaps = new SvelteMap()

  // When a new measured frame arrives, the stale-bounds guard AND the drag
  // snapshot are no longer needed — the fresh frame already shows the element
  // at its new position. untrack keeps these out of the effect's dependency
  // set so it only fires on a genuine new frame, not on our own drag writes.
  $effect(() => {
    void measuredElements
    untrack(() => {
      if (movedIds.size > 0) movedIds = new Set()
      if (dragSnaps.size > 0) dragSnaps.clear()
    })
  })

  let draggingIds = $derived(dragBase ? new Set([...dragBase.positions.keys()]) : new Set())

  function getRotation(id) {
    const el = elById(id)
    if (!el || !['plot', 'meter', 'gauge', 'rect', 'image'].includes(el.type)) return 0
    return el.rotation ?? 0
  }

  function rotationFor(id) {
    if (liveRotation?.id === id) return liveRotation.degrees
    return getRotation(id)
  }

  function handleRotate(id, degrees) {
    liveRotation = { id, degrees }
  }

  function handleRotateEnd(id, degrees) {
    liveRotation = null
    const el = elById(id)
    if (!el || !['plot', 'meter', 'gauge', 'rect', 'image'].includes(el.type)) return
    app.updateElement(id, { rotation: Math.round(degrees) })
  }

  function isGroupDrag(id) {
    return selectedSet.size > 1 && selectedSet.has(id)
  }

  function handleSelect(id, e) {
    if (e?.shiftKey) {
      app.toggleElementSelection(id)
    } else if (isGroupDrag(id)) {
      // Keep the multi-selection so a plain drag moves the whole group.
    } else {
      app.selectedElementId = id
    }
  }

  // Capture pre-drag state on the first move so we always delta from the
  // original authored position, not from a live-updated intermediate one.
  function ensureDragBase(leadId) {
    if (dragBase) return
    const ids = isGroupDrag(leadId) ? [...selectedSet] : [leadId]
    const positions = new SvelteMap()
    const baseElements = new SvelteMap()
    for (const sid of ids) {
      const item = elById(sid)
      if (!item || item.locked) continue
      positions.set(sid, { id: sid, x: item.x ?? 0, y: item.y ?? 0 })
      const elData = elements.find(e => e.id === sid)
      if (elData) baseElements.set(sid, { id: sid, x: elData.x, y: elData.y, w: elData.w, h: elData.h })
    }
    dragBase = { preDragConfig: JSON.stringify(app.config), positions, baseElements }
    buildDragSnaps([...baseElements.keys()])
  }

  // Crop each dragged element out of the current rendered frame so its real
  // pixels can be floated under the cursor. Uses SVG viewBox clipping so the
  // original frame image is referenced directly — no canvas re-encode that
  // corrupts semi-transparent pixels via premultiplied alpha.
  function buildDragSnaps(ids) {
    if (!frameImage) return
    for (const id of ids) {
      const b = dragBase?.baseElements.get(id)
      if (!b) continue
      const el = elById(id)
      // Outside-stroke borders extend beyond element bounds by border_width px;
      // use a pad large enough to capture the full border.
      const hasBorder = (el?.type === 'rect' || el?.type === 'meter') && el.border_color
      const pad = hasBorder
        ? Math.max(2, (el.border_width ?? 2) + 2)
        : 2
      const sx = Math.max(0, Math.floor(b.x - pad))
      const sy = Math.max(0, Math.floor(b.y - pad))
      const sw = Math.min(sceneWidth - sx, Math.ceil(b.w + pad * 2))
      const sh = Math.min(sceneHeight - sy, Math.ceil(b.h + pad * 2))
      if (sw <= 0 || sh <= 0) continue
      const prev = dragSnaps.get(id)
      dragSnaps.set(id, {
        url: frameImage,
        sx, sy, sw, sh,
        baseX: sx,
        baseY: sy,
        x: prev?.x ?? sx,
        y: prev?.y ?? sy,
        w: sw,
        h: sh,
      })
    }
  }

  function moveDragSnaps(dx, dy) {
    for (const [id, s] of dragSnaps) {
      dragSnaps.set(id, { ...s, x: s.baseX + dx, y: s.baseY + dy })
    }
  }

  // dx/dy are in output space; config x/y are authored — use the pre-drag
  // authored position so repeated calls with the same delta stay idempotent.
  function moveFor(id, dx, dy) {
    const base = dragBase?.positions.get(id)
    const s = authorScale || 1
    if (base) return { id, x: base.x + dx / s, y: base.y + dy / s }
    const item = elById(id)
    if (!item) return null
    return { id, x: (item.x ?? 0) + dx / s, y: (item.y ?? 0) + dy / s }
  }

  function handleDrag(id, dx, dy) {
    ensureDragBase(id)
    // Float the cropped real pixels under the cursor. No live re-render: a
    // server-side render can't keep up with a drag, and queuing them only
    // delays the single commit render we want immediately on drop.
    liveGroup = isGroupDrag(id) ? { leaderId: id, dx, dy } : null
    moveDragSnaps(dx, dy)
  }

  function handleDragEnd(id, dx, dy) {
    ensureDragBase(id)
    const ids = isGroupDrag(id) ? [...selectedSet] : [id]
    const moves = ids.map(sid => moveFor(sid, dx, dy)).filter(Boolean)

    // Mark moved elements so the derived skips their stale measured bounds.
    if (moves.length > 0) {
      const next = new SvelteSet(movedIds)
      for (const m of moves) next.add(m.id)
      movedIds = next
    }

    // Freeze the snapshot at the drop point; it stays until the fresh frame
    // arrives (cleared by the measuredElements effect), so no blank gap.
    moveDragSnaps(dx, dy)
    app.commitElementPositions(dragBase?.preDragConfig ?? null, moves)
    dragBase = null
    liveGroup = null
  }

  function groupOffsetFor(id) {
    if (liveGroup && liveGroup.leaderId !== id && selectedSet.has(id)) {
      return { dx: liveGroup.dx, dy: liveGroup.dy }
    }
    return { dx: 0, dy: 0 }
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  // Captured at the start of a resize so deltas are always relative to the
  // original authored dimensions, not intermediate live-updated values.
  let resizeBase = $state(null) // { preConfig, id, origX, origY, origW, origH }

  function applyResizeDelta(origX, origY, origW, origH, corner, dx, dy, shiftKey, naturalW = null, naturalH = null) {
    const s = authorScale || 1
    // dx/dy are in output px; element coords are authored → undo the scale.
    const adx = dx / s
    const ady = dy / s

    // Raw dimension change per corner (positive = larger)
    let dw, dh
    switch (corner) {
      case 'br': dw =  adx; dh =  ady; break
      case 'bl': dw = -adx; dh =  ady; break
      case 'tr': dw =  adx; dh = -ady; break
      case 'tl': dw = -adx; dh = -ady; break
      default:   dw =  adx; dh =  ady
    }

    let newW = origW + dw
    let newH = origH + dh

    if (shiftKey && origW > 0 && origH > 0) {
      const aw = naturalW ?? origW
      const ah = naturalH ?? origH
      const ratio = aw / ah
      // Lock aspect: project onto dominant axis
      if (Math.abs(dw / origW) >= Math.abs(dh / origH)) {
        newH = newW / ratio
      } else {
        newW = newH * ratio
      }
    }

    // Minimum size
    newW = Math.max(newW, 4)
    newH = Math.max(newH, 4)

    // Compute x/y: the corner opposite to the dragged one is fixed.
    let newX = origX, newY = origY
    switch (corner) {
      case 'br': /* top-left fixed — x/y unchanged */                         break
      case 'bl': newX = origX + origW - newW;                                 break
      case 'tr':                               newY = origY + origH - newH;   break
      case 'tl': newX = origX + origW - newW; newY = origY + origH - newH;   break
    }

    return {
      x: Math.round(newX),
      y: Math.round(newY),
      width:  Math.round(newW),
      height: Math.round(newH),
    }
  }

  function handleResize(id, corner, dx, dy, shiftKey) {
    if (!resizeBase) {
      const el = elById(id)
      if (!el) return
      resizeBase = {
        preConfig: JSON.stringify(app.config),
        id,
        origX: el.x ?? 0,
        origY: el.y ?? 0,
        origW: el.width ?? 100,
        origH: el.height ?? 100,
        naturalW: el.natural_width ?? null,
        naturalH: el.natural_height ?? null,
      }
    }
    const { origX, origY, origW, origH, naturalW, naturalH } = resizeBase
    const lockAspect = shiftKey || elById(id)?.type === 'image'
    const updates = applyResizeDelta(origX, origY, origW, origH, corner, dx, dy, lockAspect, naturalW, naturalH)
    // Store live bounds locally — do NOT write to config until release.
    // This keeps the reactive cascade (ElementProperties, CenterCanvas debounce,
    // etc.) from firing on every pointer move.
    const s = authorScale || 1
    liveResize = {
      id,
      bounds: { x: updates.x * s, y: updates.y * s, w: updates.width * s, h: updates.height * s },
    }
  }

  function handleResizeEnd(id, corner, dx, dy, shiftKey) {
    if (!resizeBase) return
    const { preConfig, origX, origY, origW, origH, naturalW, naturalH } = resizeBase
    const lockAspect = shiftKey || elById(id)?.type === 'image'
    const updates = applyResizeDelta(origX, origY, origW, origH, corner, dx, dy, lockAspect, naturalW, naturalH)
    app.commitElementUpdate(preConfig, id, updates)
    resizeBase = null
    liveResize = null
    // Mark moved so config-derived bounds are used until the fresh render arrives.
    const next = new SvelteSet(movedIds)
    next.add(id)
    movedIds = next
  }

  // ── Marquee (rubber-band) selection ───────────────────────────────────────
  let marquee = $state(null) // normalized scene-coord rect being drawn
  let marqueeStart = null // scene-coord anchor
  let marqueeClient = null // client px anchor (drag-vs-click detection)
  let marqueeMoved = false

  function clientToScene(svg, cx, cy) {
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  function bgPointerDown(e) {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const p = clientToScene(svg, e.clientX, e.clientY)
    marqueeStart = p
    marqueeClient = { cx: e.clientX, cy: e.clientY }
    marqueeMoved = false
    marquee = { x: p.x, y: p.y, w: 0, h: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function bgPointerMove(e) {
    if (!marqueeStart) return
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    if (
      Math.abs(e.clientX - marqueeClient.cx) > 3 ||
      Math.abs(e.clientY - marqueeClient.cy) > 3
    )
      marqueeMoved = true
    const p = clientToScene(svg, e.clientX, e.clientY)
    marquee = {
      x: Math.min(marqueeStart.x, p.x),
      y: Math.min(marqueeStart.y, p.y),
      w: Math.abs(p.x - marqueeStart.x),
      h: Math.abs(p.y - marqueeStart.y),
    }
  }

  function bgPointerUp() {
    if (!marqueeStart) return
    if (marqueeMoved && marquee) {
      const minX = marquee.x
      const minY = marquee.y
      const maxX = marquee.x + marquee.w
      const maxY = marquee.y + marquee.h
      const hit = elements
        .filter(
          (el) =>
            !(
              el.x + el.w < minX ||
              el.x > maxX ||
              el.y + el.h < minY ||
              el.y > maxY
            ),
        )
        .map((el) => el.id)
      app.setSelectedElements(hit)
    } else {
      app.selectedElementId = null // plain click on empty space → deselect
    }
    marquee = null
    marqueeStart = null
  }
</script>

{#if app.config}
<svg
  viewBox={`0 0 ${sceneWidth} ${sceneHeight}`}
  style="position:absolute; inset:0; width:100%; height:100%; overflow:visible; pointer-events:none"
  xmlns="http://www.w3.org/2000/svg"
>
  <!-- Background: drag to marquee-select, click to deselect.
       FIRST so handles paint on top -->
  <rect
    role="presentation"
    x={0} y={0}
    width={sceneWidth} height={sceneHeight}
    fill="transparent"
    style="pointer-events:all; cursor:crosshair"
    onpointerdown={bgPointerDown}
    onpointermove={bgPointerMove}
    onpointerup={bgPointerUp}
    onkeydown={(e) => { if (e.key === 'Escape') app.selectedElementId = null }}
  />

  <!-- Cropped real pixels of the dragged element(s), under the handle boxes
       so the border/handles stay on top. Nested SVG viewBox clips the full
       frame image to the element region without re-encoding, preserving
       semi-transparent pixels correctly. -->
  {#each [...dragSnaps] as [sid, s] (sid)}
    <svg
      x={s.x}
      y={s.y}
      width={s.w}
      height={s.h}
      viewBox="{s.sx} {s.sy} {s.sw} {s.sh}"
      overflow="hidden"
      style="pointer-events:none"
    >
      <image
        href={s.url}
        x="0"
        y="0"
        width={sceneWidth}
        height={sceneHeight}
        preserveAspectRatio="none"
        style="pointer-events:none"
      />
    </svg>
  {/each}

  {#each elements as el (el.id)}
    <ElementHandle
      id={el.id}
      bounds={{ x: el.x, y: el.y, w: el.w, h: el.h }}
      label={handleLabel(el.id)}
      selected={selectedSet.has(el.id)}
      rotation={rotationFor(el.id)}
      groupOffset={groupOffsetFor(el.id)}
      {zoom}
      resizable={['rect', 'meter', 'gauge', 'plot', 'image'].includes(elById(el.id)?.type)}
      locked={elById(el.id)?.locked === true}
      onselect={(e) => handleSelect(el.id, e)}
      ondrag={(dx, dy) => handleDrag(el.id, dx, dy)}
      ondragend={(dx, dy) => handleDragEnd(el.id, dx, dy)}
      onrotate={(deg) => handleRotate(el.id, deg)}
      onrotateend={(deg) => handleRotateEnd(el.id, deg)}
      onresize={(corner, dx, dy, shift) => handleResize(el.id, corner, dx, dy, shift)}
      onresizeend={(corner, dx, dy, shift) => handleResizeEnd(el.id, corner, dx, dy, shift)}
    />
  {/each}

  {#if marquee && (marquee.w > 0 || marquee.h > 0)}
    <rect
      x={marquee.x} y={marquee.y}
      width={marquee.w} height={marquee.h}
      fill="rgba(220,20,60,0.12)"
      stroke="#DC143C" stroke-width="1" stroke-dasharray="4 3"
      style="pointer-events:none"
    />
  {/if}
</svg>
{/if}
