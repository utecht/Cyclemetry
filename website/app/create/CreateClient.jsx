'use client'

import { useEffect, useRef, useState } from 'react'
import {
  loadEngine,
  writeFile,
  initSession,
  renderOverlayFrame,
  retimeTemplate,
} from './lib/engine'
import {
  loadBackground,
  releaseBackground,
  compositeFrame,
  MAX_CLIP_SECONDS,
} from './lib/background'
import { exportMp4, ExportCanceled } from './lib/exportVideo'
import { exportPng } from './lib/exportStill'
import {
  buildTimeline,
  overlayFrameAt,
  MIN_OVERLAY_SECONDS,
  MAX_OVERLAY_SECONDS,
} from './lib/timeline'

// The overlay pipeline (same Rust/Skia engine as the desktop app) runs in wasm;
// the background clip is decoded and the finished mp4 encoded with WebCodecs.
// Nothing leaves the device.
//
// Nothing is rendered until a ride is loaded: before that the page is a template
// picker, and the stage shows the chosen template's preview rather than a demo
// ride that isn't the user's.

const MANIFEST_URL = '/create/manifest.json'

/** Templates are authored at 4K; render the web export at 1080 on the long edge. */
const MAX_EDGE = 1920

function outputSize({ width, height }) {
  const scale = MAX_EDGE / Math.max(width, height)
  const even = (n) => Math.round((n * scale) / 2) * 2 // odd dimensions break encoders
  return { width: even(width), height: even(height) }
}

/** The template's own animation length, used when there's no clip to match. */
function templateSeconds(templateText) {
  const scene = JSON.parse(templateText).scene
  return clampOverlay(scene.target_duration ?? 5)
}

function clampOverlay(seconds, ceiling = MAX_OVERLAY_SECONDS) {
  return Math.min(Math.max(seconds, MIN_OVERLAY_SECONDS), ceiling)
}

function formatSize(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`
}

function UploadTile({ label, hint, accept, file, onPick, onClear, disabled, openRef }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  // Lets the empty stage open this same picker instead of owning a second input.
  useEffect(() => {
    if (openRef) openRef.current = () => inputRef.current?.click()
  }, [openRef])

  return (
    <div
      className={`tile${dragging ? ' tile-drag' : ''}${disabled ? ' tile-off' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const dropped = e.dataTransfer.files?.[0]
        if (dropped && !disabled) onPick(dropped)
      }}
    >
      <button
        type="button"
        className="tile-hit"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span className="tile-text">
          <span className="tile-label">{file ? file : label}</span>
          <span className="tile-hint">{file ? 'Tap to replace' : hint}</span>
        </span>
        <span className="tile-cta">{file ? 'Change' : 'Choose'}</span>
      </button>

      {file && onClear && (
        <button
          type="button"
          className="tile-clear"
          onClick={onClear}
          aria-label={`Remove ${file}`}
        >
          Remove
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = '' // let the same file be re-picked
          if (picked) onPick(picked)
        }}
      />
    </div>
  )
}

/**
 * One track for the whole clip, with the overlay's animation window drawn on it:
 * drag either handle to retime the ends, drag the window itself to slide it. The
 * playhead rides the same track, so there is a single place to read the timing.
 *
 * The two gestures live in separate bands so they can't fight: retiming happens
 * on the track itself, scrubbing in the strip above it (where the playhead is).
 */
function RangeBar({
  domain,
  start,
  end,
  minLength,
  maxLength,
  lockStart,
  disabled,
  headRef,
  onChange,
  onSeek,
}) {
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const [grabbed, setGrabbed] = useState(null)

  const pct = (t) => `${(t / domain) * 100}%`

  function timeAt(clientX) {
    const rect = trackRef.current.getBoundingClientRect()
    const t = ((clientX - rect.left) / rect.width) * domain
    return Math.min(Math.max(t, 0), domain)
  }

  function begin(e, handle) {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const anchor = handle === 'end' ? end : start
    dragRef.current = { handle, grab: timeAt(e.clientX) - anchor }
    setGrabbed(handle)
  }

  // Emits (start, length) rather than two endpoints: sliding the window reuses
  // the current length untouched, so a pure slide can't drift the overlay's
  // duration by a rounding step and force a wasm rebuild.
  function move(e) {
    const drag = dragRef.current
    if (!drag) return
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
    const t = Math.round((timeAt(e.clientX) - drag.grab) * 10) / 10 // 0.1s grid
    const length = end - start

    if (drag.handle === 'start') {
      const next = clamp(t, Math.max(0, end - maxLength), end - minLength)
      onChange(next, end - next)
    } else if (drag.handle === 'end') {
      const next = clamp(t, start + minLength, Math.min(domain, start + maxLength))
      onChange(start, next - start)
    } else {
      const next = clamp(t, 0, domain - length)
      onChange(next, length)
    }
  }

  function release() {
    dragRef.current = null
    setGrabbed(null)
  }

  const grip = (handle) => ({
    onPointerDown: (e) => begin(e, handle),
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: release,
  })

  // The scrub strip jumps to wherever it's pressed, then tracks the pointer —
  // no grab offset, since the playhead is a hairline you aim at, not a knob.
  const seekBand = {
    onPointerDown: (e) => {
      if (disabled) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { handle: 'seek' }
      onSeek(timeAt(e.clientX))
    },
    onPointerMove: (e) => {
      if (dragRef.current?.handle === 'seek') onSeek(timeAt(e.clientX))
    },
    onPointerUp: release,
    onPointerCancel: release,
  }

  return (
    <div className={`scrub${disabled ? ' scrub-off' : ''}`}>
      <div ref={trackRef} className="scrub-track">
        <div className="scrub-seek" {...seekBand} />
        <span ref={headRef} className="scrub-head" aria-hidden="true" />
        <div
          className={`scrub-window${grabbed === 'window' ? ' scrub-live' : ''}`}
          style={{ left: pct(start), width: pct(end - start) }}
          {...grip('window')}
        />
        {!lockStart && (
          <div
            className={`scrub-grip${grabbed === 'start' ? ' scrub-live' : ''}`}
            style={{ left: pct(start) }}
            role="slider"
            aria-label="Overlay start"
            aria-valuenow={Number(start.toFixed(1))}
            {...grip('start')}
          />
        )}
        <div
          className={`scrub-grip${grabbed === 'end' ? ' scrub-live' : ''}`}
          style={{ left: pct(end) }}
          role="slider"
          aria-label="Overlay end"
          aria-valuenow={Number(end.toFixed(1))}
          {...grip('end')}
        />
      </div>
    </div>
  )
}

export default function CreateClient() {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const pixelsRef = useRef(null)
  const modRef = useRef(null)
  const baseTemplateRef = useRef(null)
  const backgroundRef = useRef(null)
  const gpxPathRef = useRef('')
  const drawTokenRef = useRef(0)
  const cancelRef = useRef(false)
  const bootedRef = useRef(false)
  const headRef = useRef(null)
  const gpxOpenRef = useRef(null) // opens the ride tile's file picker from the stage
  const domainRef = useRef(MAX_OVERLAY_SECONDS)
  const timelineRef = useRef(null)
  const lastOverlayRef = useRef(-1)
  const playRef = useRef({ raf: 0, startedAt: 0, lastIdx: -1, drawing: false })

  const [engineReady, setEngineReady] = useState(false)
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(null)
  const [session, setSession] = useState(null) // null until a ride is loaded
  const [clipSeconds, setClipSeconds] = useState(null) // null unless a video is loaded
  const [overlaySeconds, setOverlaySeconds] = useState(null)
  const [startSeconds, setStartSeconds] = useState(0)
  const [revision, setRevision] = useState(0) // bumped when the ride or background changes
  const [playing, setPlaying] = useState(true)
  const [mode, setMode] = useState('video') // what Export produces: 'video' | 'still'
  const [headFrame, setHeadFrame] = useState(0) // the paused playhead; the frame a still exports
  const [gpxName, setGpxName] = useState(null)
  const [bgName, setBgName] = useState(null)
  const [dropping, setDropping] = useState(false) // a GPX is hovering over the empty stage
  const [status, setStatus] = useState('Starting render engine…')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  const template = templates.find((t) => t.id === templateId) ?? null
  const timeline = session ? buildTimeline(session, clipSeconds, startSeconds) : null
  timelineRef.current = timeline

  /** Size the canvases to the session's output, which the template decides. */
  function sizeCanvases(w, h) {
    overlayRef.current.width = w
    overlayRef.current.height = h
    pixelsRef.current = new ImageData(w, h)
    canvasRef.current.width = w
    canvasRef.current.height = h
    lastOverlayRef.current = -1
  }

  /** Draw output frame `i` — background at i/fps, overlay at its own offset clock. */
  async function drawPreview(i) {
    const token = ++drawTokenRef.current
    const mod = modRef.current
    const canvas = canvasRef.current
    const tl = timelineRef.current
    if (!mod || !canvas || !tl) return

    const overlayIdx = overlayFrameAt(tl, i)
    if (overlayIdx >= 0 && overlayIdx !== lastOverlayRef.current) {
      renderOverlayFrame(mod, overlayIdx, pixelsRef.current)
      overlayRef.current.getContext('2d').putImageData(pixelsRef.current, 0, 0)
    }
    lastOverlayRef.current = overlayIdx

    const bg = backgroundRef.current
    const sample = bg?.kind === 'video' ? await bg.sink.getSample(i / tl.fps) : null
    if (token !== drawTokenRef.current) {
      sample?.close()
      return // a newer draw already won
    }
    compositeFrame(
      canvas.getContext('2d'),
      tl.width,
      tl.height,
      bg,
      sample,
      overlayIdx >= 0 ? overlayRef.current : null,
    )
    sample?.close()

    if (headRef.current) {
      headRef.current.style.left = `${(i / tl.fps / domainRef.current) * 100}%`
    }
  }

  function rewind() {
    playRef.current.startedAt = performance.now()
    playRef.current.lastIdx = -1
    lastOverlayRef.current = -1
    setHeadFrame(0)
  }

  /** Resume the loop from the frame on screen rather than snapping back to 0. */
  function resume() {
    const held = Math.max(playRef.current.lastIdx, 0)
    playRef.current.startedAt = performance.now() - (held / timelineRef.current.fps) * 1000
    setPlaying(true)
  }

  /** Park the playhead on a frame. Scrubbing takes over from the loop. */
  function seekTo(seconds) {
    const tl = timelineRef.current
    if (!tl) return
    const frame = Math.min(Math.max(Math.round(seconds * tl.fps), 0), tl.totalFrames - 1)
    playRef.current.lastIdx = frame
    setPlaying(false)
    setHeadFrame(frame) // the paused-draw effect paints it
  }

  /** Both ends of the overlay window come from the one scrub bar. */
  function setRange(start, length) {
    setStartSeconds(start)
    setOverlaySeconds(length)
    rewind()
  }

  // Rebuild the wasm scene whenever the ride, the background, or the overlay's
  // length changes — the length lives in the template, so it needs a re-init.
  // Debounced so dragging the duration slider doesn't re-parse the GPX on every
  // pixel. The start offset is pure timeline math and never lands here.
  //
  // No ride, no scene: the wasm engine can synthesize a demo activity, but a
  // stranger's numbers on screen are worse than no preview at all.
  useEffect(() => {
    if (!bootedRef.current || !template || !gpxPathRef.current || overlaySeconds == null) return
    const timer = setTimeout(async () => {
      setStatus('Building your ride…')
      setBusy(true)
      try {
        const out = outputSize(template)
        const retimed = retimeTemplate(baseTemplateRef.current, overlaySeconds)
        const built = initSession(
          modRef.current,
          retimed,
          gpxPathRef.current,
          out.width,
          out.height,
        )
        sizeCanvases(built.width, built.height)
        setSession(built)
        setResult(null)
        rewind()
      } catch (e) {
        setError(String(e?.message ?? e))
      } finally {
        setBusy(false)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [revision, overlaySeconds])

  // Pull the chosen template's JSON and fonts into the wasm filesystem. Changing
  // template resets the overlay's length to whatever that template wants (or to
  // the clip, when there is one) and rebuilds the scene if a ride is loaded.
  useEffect(() => {
    if (!engineReady || !templateId) return
    const picked = templates.find((t) => t.id === templateId)
    let stale = false

    ;(async () => {
      setStatus('Loading template…')
      setBusy(true)
      try {
        const [templateText, ...fonts] = await Promise.all([
          fetch(picked.template).then((r) => {
            if (!r.ok) throw new Error(`failed to load the ${picked.name} template`)
            return r.text()
          }),
          ...picked.fonts.map((font) =>
            fetch(`/create/fonts/${encodeURIComponent(font)}`).then((r) => {
              if (!r.ok) throw new Error(`failed to load the font ${font}`)
              return r.arrayBuffer()
            }),
          ),
        ])
        if (stale) return

        picked.fonts.forEach((font, i) => {
          writeFile(modRef.current, `/fonts/${font}`, new Uint8Array(fonts[i]))
        })
        baseTemplateRef.current = templateText
        bootedRef.current = true

        setResult(null)
        setStartSeconds(0)
        setOverlaySeconds(
          clipSeconds ? clampOverlay(clipSeconds, clipSeconds) : templateSeconds(templateText),
        )
        setRevision((r) => r + 1)
      } catch (e) {
        if (!stale) setError(String(e?.message ?? e))
      } finally {
        if (!stale) setBusy(false)
      }
    })()

    return () => {
      stale = true
    }
    // clipSeconds is read, not tracked: a new clip retimes the overlay through
    // its own handler, and re-running this on every clip swap would refetch the
    // template for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, templateId, templates])

  // Play the overlay as a loop rather than a scrubber: the timeline is a few
  // seconds long, so a phone-shaped preview is better served by watching it
  // than by dragging it. Frames are picked from wall-clock time, so a slow
  // render drops frames instead of running the loop in slow motion.
  useEffect(() => {
    const state = playRef.current
    if (!playing || !session) return

    let stopped = false
    const tick = () => {
      if (stopped) return
      const { totalFrames, fps } = timelineRef.current
      const elapsed = (performance.now() - state.startedAt) / 1000
      const idx = Math.floor(elapsed * fps) % totalFrames
      if (idx !== state.lastIdx && !state.drawing) {
        if (idx < state.lastIdx) lastOverlayRef.current = -1 // loop wrapped
        state.lastIdx = idx
        state.drawing = true
        drawPreview(idx)
          .catch((e) => setError(String(e?.message ?? e)))
          .finally(() => {
            state.drawing = false
          })
      }
      state.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)

    return () => {
      stopped = true
      cancelAnimationFrame(state.raf)
    }
  }, [playing, session, startSeconds])

  // With the loop stopped the playhead alone says what's on screen, so a seek, a
  // retime, or a rebuilt session all repaint through here.
  useEffect(() => {
    if (playing || !session) return
    drawPreview(headFrame).catch((e) => setError(String(e?.message ?? e)))
  }, [playing, session, headFrame, startSeconds])

  useEffect(() => {
    ;(async () => {
      try {
        setStatus('Loading templates…')
        const [mod, manifest] = await Promise.all([
          loadEngine(),
          fetch(MANIFEST_URL).then((r) => {
            if (!r.ok) throw new Error('failed to load the template list')
            return r.json()
          }),
        ])
        if (!manifest.length) throw new Error('no templates are available')
        modRef.current = mod
        overlayRef.current = document.createElement('canvas')

        setTemplates(manifest)
        setTemplateId(manifest[0].id) // the template effect takes it from here
        setEngineReady(true)
      } catch (e) {
        setError(String(e?.message ?? e))
        setBusy(false)
      }
    })()
  }, [])

  function togglePlay() {
    if (playing) {
      setHeadFrame(Math.max(playRef.current.lastIdx, 0)) // park on the frame showing
      setPlaying(false)
    } else {
      resume()
    }
  }

  /**
   * The mode picks what Export produces. A still is a frame, so choosing it stops
   * the loop and hands the timeline over to the playhead; going back to video
   * picks the loop up from that same frame.
   */
  function selectMode(next) {
    if (next === mode) return
    setMode(next)
    setResult(null)
    if (next === 'still' && playing) {
      setHeadFrame(Math.max(playRef.current.lastIdx, 0))
      setPlaying(false)
    } else if (next === 'video' && !playing) {
      resume()
    }
  }

  async function onGpxPicked(file) {
    setBusy(true)
    setError(null)
    try {
      setStatus('Reading ride…')
      writeFile(modRef.current, '/ride.gpx', new Uint8Array(await file.arrayBuffer()))
      gpxPathRef.current = '/ride.gpx'
      setGpxName(file.name)
      setRevision((r) => r + 1)
    } catch (e) {
      setError(String(e?.message ?? e))
      setBusy(false)
    }
  }

  async function onBackgroundPicked(file) {
    setBusy(true)
    setError(null)
    try {
      setStatus('Reading background…')
      const bg = await loadBackground(file)
      releaseBackground(backgroundRef.current)
      backgroundRef.current = bg
      setBgName(file.name)

      if (bg.kind === 'video') {
        // Default: the overlay sweeps the whole ride across the whole clip.
        setClipSeconds(bg.duration)
        setOverlaySeconds(clampOverlay(bg.duration, bg.duration))
        setStartSeconds(0)
      } else {
        setClipSeconds(null)
      }
      setRevision((r) => r + 1)
      // The scene effect clears `busy` once it rebuilds; with no ride yet there
      // is nothing to rebuild, so clear it here or the page stays stuck.
      if (!gpxPathRef.current) setBusy(false)
    } catch (e) {
      setError(String(e?.message ?? e))
      setBusy(false)
    }
  }

  function clearBackground() {
    releaseBackground(backgroundRef.current)
    backgroundRef.current = null
    setBgName(null)
    setClipSeconds(null)
    setStartSeconds(0)
    if (baseTemplateRef.current) setOverlaySeconds(templateSeconds(baseTemplateRef.current))
    setRevision((r) => r + 1)
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob)
    setResult({ url, size: blob.size, name })
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  }

  /** A still is one frame, so it needs neither the progress bar nor the cancel path. */
  async function onExportStill() {
    setStatus('Rendering still…')
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const blob = await exportPng({
        mod: modRef.current,
        timeline,
        background: backgroundRef.current,
        frame: headFrame,
      })
      save(blob, 'cyclemetry.png')
    } catch (e) {
      setError(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function onExportVideo() {
    cancelRef.current = false
    setPlaying(false) // the encoder needs the wasm session and the canvases
    setProgress(0)
    setError(null)
    setResult(null)
    try {
      const blob = await exportMp4({
        mod: modRef.current,
        timeline,
        background: backgroundRef.current,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      })
      save(blob, 'cyclemetry.mp4')
    } catch (e) {
      if (!(e instanceof ExportCanceled)) setError(String(e?.message ?? e))
    } finally {
      setProgress(null)
      rewind()
      setPlaying(true)
    }
  }

  const exporting = progress !== null
  const previewAspect = template
    ? `${outputSize(template).width} / ${outputSize(template).height}`
    : '9 / 16'
  const seconds = timeline ? timeline.seconds : 0
  const overlayEnd = (startSeconds ?? 0) + (overlaySeconds ?? 0)
  const domain = clipSeconds ?? MAX_OVERLAY_SECONDS
  domainRef.current = domain
  const headSeconds = timeline ? headFrame / timeline.fps : 0

  return (
    <div className="create">
      <style>{css}</style>

      <header className="head">
        <h1>Create</h1>
        <span className="head-note">On device</span>
      </header>

      <div className="stage">
        {/* In still mode the playhead is the only thing that moves the frame, so
            the loop stays out of it — otherwise the preview and the frame the
            export takes could drift apart. */}
        <button
          type="button"
          className="preview-hit"
          hidden={!session}
          disabled={!session || exporting || mode === 'still'}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={togglePlay}
        >
          <canvas ref={canvasRef} className="preview" style={{ aspectRatio: previewAspect }} />
          {!playing && !exporting && mode === 'video' && (
            <span className="preview-glyph" aria-hidden="true">
              ▶
            </span>
          )}
        </button>

        {/* No ride, nothing on the stage. Showing a stand-in ride here would put
            numbers on screen that aren't the user's — what the template looks
            like is the template cards' job. The canvas stays mounted underneath;
            the refs depend on it. */}
        {!session && (
          <button
            type="button"
            className={`empty${dropping ? ' empty-drag' : ''}`}
            style={{ aspectRatio: previewAspect }}
            disabled={busy}
            onClick={() => gpxOpenRef.current?.()}
            onDragOver={(e) => {
              e.preventDefault()
              setDropping(true)
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDropping(false)
              const dropped = e.dataTransfer.files?.[0]
              if (dropped && !busy) onGpxPicked(dropped)
            }}
          >
            <span className="empty-glyph" aria-hidden="true">
              ↑
            </span>
            <span className="empty-text">
              {busy ? status : 'Add your ride'}
              {!busy && <span className="empty-sub">Drop a GPX file, or tap to choose</span>}
            </span>
          </button>
        )}
      </div>

      {templates.length > 0 && (
        <div className="picker">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`card${t.id === templateId ? ' card-on' : ''}`}
              aria-pressed={t.id === templateId}
              disabled={busy || exporting}
              onClick={() => setTemplateId(t.id)}
            >
              <img className="card-thumb" src={t.preview} alt="" />
              <span className="card-text">
                <span className="card-name">{t.name}</span>
                <span className="card-blurb">{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {session && overlaySeconds != null && (
        <div className="timing">
          <RangeBar
            domain={domain}
            start={startSeconds}
            end={Math.min(overlayEnd, domain)}
            minLength={MIN_OVERLAY_SECONDS}
            maxLength={Math.min(MAX_OVERLAY_SECONDS, domain)}
            lockStart={clipSeconds == null}
            disabled={exporting}
            headRef={headRef}
            onChange={setRange}
            onSeek={seekTo}
          />
          <div className="timing-read">
            <span>{startSeconds.toFixed(1)}s</span>
            {mode === 'still' ? (
              <span className="timing-len">still · {headSeconds.toFixed(1)}s</span>
            ) : (
              <span className="timing-len">overlay · {overlaySeconds.toFixed(1)}s</span>
            )}
            <span>{overlayEnd.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {(error || busy) && <p className={error ? 'msg msg-error' : 'msg'}>{error ?? status}</p>}

      <div className="tiles">
        <UploadTile
          label="Ride data"
          hint="GPX from Strava, Garmin, Wahoo"
          accept=".gpx,.fit"
          file={gpxName}
          onPick={onGpxPicked}
          disabled={busy || exporting}
          openRef={gpxOpenRef}
        />
        <UploadTile
          label="Background photo or clip"
          hint={`Optional — video is trimmed to ${MAX_CLIP_SECONDS}s`}
          accept="image/*,video/*"
          file={bgName}
          onPick={onBackgroundPicked}
          onClear={clearBackground}
          disabled={busy || exporting}
        />
      </div>

      {exporting ? (
        <div className="export">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="export-row">
            <span className="msg">Encoding… {Math.round(progress * 100)}%</span>
            <button type="button" className="btn-ghost" onClick={() => (cancelRef.current = true)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        session && (
        <div className="export">
          <div className="seg" role="group" aria-label="What to export">
            <button
              type="button"
              className={`seg-opt${mode === 'video' ? ' seg-on' : ''}`}
              aria-pressed={mode === 'video'}
              disabled={busy}
              onClick={() => selectMode('video')}
            >
              Video
            </button>
            <button
              type="button"
              className={`seg-opt${mode === 'still' ? ' seg-on' : ''}`}
              aria-pressed={mode === 'still'}
              disabled={busy}
              onClick={() => selectMode('still')}
            >
              Still
            </button>
          </div>

          <button
            type="button"
            className="btn"
            disabled={!session || busy}
            onClick={mode === 'still' ? onExportStill : onExportVideo}
          >
            {mode === 'still'
              ? `Export PNG · ${headSeconds.toFixed(1)}s`
              : `Export mp4 · ${seconds.toFixed(1)}s`}
          </button>

          {mode === 'still' && <p className="msg">Drag the playhead to pick the frame.</p>}
        </div>
        )
      )}

      {result && (
        <a className="btn-ghost btn-block" href={result.url} download={result.name}>
          Save again · {formatSize(result.size)}
        </a>
      )}
    </div>
  )
}

const css = `
.create {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px calc(48px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.head h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.015em; }
.head-note { font-size: 12px; color: #6F6F6F; }

.stage {
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(220,20,60,0.09), transparent 58%),
    #121212;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  justify-content: center;
}
.preview-hit {
  position: relative;
  display: block;
  width: 100%;
  max-width: 260px;
  padding: 0;
  border: 0;
  background: none;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.preview-hit:disabled { cursor: default; }
.preview {
  display: block;
  width: 100%;
  background: #1C1C1C;
}

/* Pre-ride stage: a drop target, not a stand-in ride. */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  max-width: 260px;
  padding: 16px;
  border: 0;
  border-radius: 6px;
  background: #1C1C1C;
  cursor: pointer;
  transition: background 150ms ease-out;
}
.empty:hover:not(:disabled), .empty-drag { background: #242424; }
.empty:disabled { cursor: default; }
.empty-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #242424;
  color: #A7A7A7;
  font-size: 18px;
}
.empty-drag .empty-glyph { background: #DC143C; color: #FAFAFA; }
.empty-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #FAFAFA;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
}
.empty-sub { color: #6F6F6F; font-size: 12px; font-weight: 400; }

.picker { display: flex; flex-direction: column; gap: 8px; }
.card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px 8px 8px;
  border: 0;
  border-radius: 10px;
  background: #1C1C1C;
  text-align: left;
  cursor: pointer;
  transition: background 150ms ease-out, box-shadow 150ms ease-out;
}
.card:hover:not(:disabled) { background: #242424; }
.card:disabled { opacity: 0.5; cursor: not-allowed; }
.card-on { background: #242424; box-shadow: inset 0 0 0 1px #DC143C; }
.card-thumb {
  flex: none;
  width: 48px;
  height: 85px; /* 9:16 */
  object-fit: cover;
  border-radius: 6px;
  background: #121212;
}
.card-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.card-name { font-size: 14px; color: #FAFAFA; }
.card-blurb { font-size: 12px; line-height: 1.4; color: #6F6F6F; }
.preview-glyph {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 56px;
  height: 56px;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 4px; /* optically center the triangle */
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  color: #FAFAFA;
  font-size: 22px;
}
.timing {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 14px;
  border-radius: 10px;
  background: #121212;
}

/* One track = the whole clip. The filled window is when the overlay animates;
   the bare track on either side is footage it isn't over (before) or where its
   last frame holds (after). Handles are 44px tall for thumbs, but read as thin. */
.scrub { padding: 26px 0 12px; touch-action: none; }
.scrub-off { opacity: 0.4; pointer-events: none; }
.scrub-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: #242424;
}
/* The scrub band sits above the track so seeking and retiming never contend for
   the same pixels: aim above the line to move the playhead, on it to retime. */
.scrub-seek {
  position: absolute;
  left: 0;
  right: 0;
  top: -26px;
  height: 26px;
  cursor: ew-resize;
  touch-action: none;
}
.scrub-window {
  position: absolute;
  top: 0;
  height: 6px;
  border-radius: 3px;
  background: #DC143C;
  cursor: grab;
}
.scrub-window:active { cursor: grabbing; }
.scrub-grip {
  position: absolute;
  top: 50%;
  width: 20px;
  height: 44px;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  touch-action: none;
}
/* the visible pill inside the oversized hit target */
.scrub-grip::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 24px;
  transform: translate(-50%, -50%);
  border-radius: 5px;
  background: #FAFAFA;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  transition: transform 120ms ease-out;
}
.scrub-grip.scrub-live::after { transform: translate(-50%, -50%) scale(1.12); }
.scrub-head {
  position: absolute;
  top: -18px;
  left: 0;
  width: 2px;
  height: 24px;
  border-radius: 1px;
  background: #FAFAFA;
  opacity: 0.9;
  pointer-events: none;
}
/* the cap reads as the thing you grab; the hit target is the band behind it */
.scrub-head::after {
  content: '';
  position: absolute;
  top: -2px;
  left: 50%;
  width: 10px;
  height: 10px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: #FAFAFA;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.timing-read {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6F6F6F;
  font-variant-numeric: tabular-nums;
}
.timing-len { color: #A7A7A7; }

.msg { font-size: 13px; line-height: 1.5; color: #6F6F6F; }
.msg-error { color: #EF4444; overflow-wrap: anywhere; }

.tiles { display: flex; flex-direction: column; gap: 8px; }
.tile { background: #1C1C1C; border-radius: 10px; transition: background 150ms ease-out; }
.tile-drag { background: #242424; }
.tile-off { opacity: 0.5; }
.tile-hit {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 12px 12px 12px 16px;
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.tile-off .tile-hit { cursor: not-allowed; }
.tile-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tile-label {
  font-size: 14px;
  color: #FAFAFA;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile-hint { font-size: 12px; color: #6F6F6F; }
.tile-cta {
  flex: none;
  padding: 8px 12px;
  border-radius: 8px;
  background: #242424;
  color: #FAFAFA;
  font-size: 13px;
  font-weight: 500;
}
.tile-clear {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  border-top: 1px solid rgba(255,255,255,0.06);
  border-radius: 0 0 10px 10px;
  background: none;
  color: #6F6F6F;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.tile-clear:hover { color: #A7A7A7; }

.btn {
  min-height: 52px;
  border: 0;
  border-radius: 10px;
  background: #DC143C;
  box-shadow: 0 0 24px rgba(220,20,60,0.25);
  color: #FAFAFA;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out;
}
.btn:hover:not(:disabled) { background: #F04060; }
.btn:disabled { background: #242424; box-shadow: none; color: #6F6F6F; cursor: not-allowed; }

.btn-ghost {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: #1C1C1C;
  color: #A7A7A7;
  font-size: 13px;
  cursor: pointer;
}
.btn-ghost:hover { background: #242424; color: #FAFAFA; }
.btn-block { display: block; min-height: 44px; line-height: 24px; text-align: center; }

/* Mode picker stays neutral — crimson is reserved for the CTA underneath it. */
.seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: #1C1C1C;
}
.seg-opt {
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: #6F6F6F;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
}
.seg-opt:hover:not(:disabled):not(.seg-on) { color: #A7A7A7; }
.seg-opt:disabled { cursor: not-allowed; }
.seg-on { background: #242424; color: #FAFAFA; }

.export { display: flex; flex-direction: column; gap: 8px; }
.bar { height: 6px; border-radius: 3px; background: #242424; overflow: hidden; }
.bar-fill { height: 100%; background: #DC143C; transition: width 150ms ease-out; }
.export-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
`
