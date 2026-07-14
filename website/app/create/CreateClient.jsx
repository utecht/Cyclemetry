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
import {
  buildTimeline,
  overlayFrameAt,
  MIN_OVERLAY_SECONDS,
  MAX_OVERLAY_SECONDS,
} from './lib/timeline'

// The overlay pipeline (same Rust/Skia engine as the desktop app) runs in wasm;
// the background clip is decoded and the finished mp4 encoded with WebCodecs.
// Nothing leaves the device.

const DEMO_FONT = 'Year in Sport Font.otf'
const OUT_W = 1080
const OUT_H = 1920

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

function UploadTile({ label, hint, accept, file, onPick, onClear, disabled }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

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

  return (
    <div className={`scrub${disabled ? ' scrub-off' : ''}`}>
      <div ref={trackRef} className="scrub-track">
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
  const domainRef = useRef(MAX_OVERLAY_SECONDS)
  const timelineRef = useRef(null)
  const lastOverlayRef = useRef(-1)
  const playRef = useRef({ raf: 0, startedAt: 0, lastIdx: -1, drawing: false })

  const [session, setSession] = useState(null)
  const [clipSeconds, setClipSeconds] = useState(null) // null unless a video is loaded
  const [overlaySeconds, setOverlaySeconds] = useState(null)
  const [startSeconds, setStartSeconds] = useState(0)
  const [revision, setRevision] = useState(0) // bumped when the ride or background changes
  const [playing, setPlaying] = useState(true)
  const [gpxName, setGpxName] = useState(null)
  const [bgName, setBgName] = useState(null)
  const [status, setStatus] = useState('Starting render engine…')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  const timeline = session ? buildTimeline(session, clipSeconds, startSeconds) : null
  timelineRef.current = timeline

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
      OUT_W,
      OUT_H,
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
  useEffect(() => {
    if (!bootedRef.current || overlaySeconds == null) return
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const template = retimeTemplate(baseTemplateRef.current, overlaySeconds)
        const built = initSession(modRef.current, template, gpxPathRef.current, OUT_W, OUT_H)
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

  useEffect(() => {
    ;(async () => {
      try {
        const mod = await loadEngine()
        modRef.current = mod

        setStatus('Loading template…')
        const [templateRes, fontRes] = await Promise.all([
          fetch('/create-demo/template.json'),
          fetch(`/create-demo/fonts/${encodeURIComponent(DEMO_FONT)}`),
        ])
        if (!templateRes.ok || !fontRes.ok) throw new Error('failed to fetch demo assets')
        baseTemplateRef.current = await templateRes.text()
        writeFile(mod, `/fonts/${DEMO_FONT}`, new Uint8Array(await fontRes.arrayBuffer()))

        overlayRef.current = document.createElement('canvas')
        overlayRef.current.width = OUT_W
        overlayRef.current.height = OUT_H
        pixelsRef.current = new ImageData(OUT_W, OUT_H)
        canvasRef.current.width = OUT_W
        canvasRef.current.height = OUT_H

        setStatus('Building demo ride…')
        bootedRef.current = true
        setOverlaySeconds(templateSeconds(baseTemplateRef.current)) // kicks off the first build
      } catch (e) {
        setError(String(e?.message ?? e))
        setBusy(false)
      }
    })()
  }, [])

  function togglePlay() {
    setPlaying((wasPlaying) => {
      if (!wasPlaying) {
        // Resume where the loop left off instead of snapping back to frame 0.
        const held = Math.max(playRef.current.lastIdx, 0)
        playRef.current.startedAt = performance.now() - (held / timelineRef.current.fps) * 1000
      }
      return !wasPlaying
    })
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
    setOverlaySeconds(templateSeconds(baseTemplateRef.current))
    setRevision((r) => r + 1)
  }

  async function onExport() {
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
      const url = URL.createObjectURL(blob)
      setResult({ url, size: blob.size })
      const a = document.createElement('a')
      a.href = url
      a.download = 'cyclemetry.mp4'
      a.click()
    } catch (e) {
      if (!(e instanceof ExportCanceled)) setError(String(e?.message ?? e))
    } finally {
      setProgress(null)
      rewind()
      setPlaying(true)
    }
  }

  const exporting = progress !== null
  const seconds = timeline ? timeline.seconds : 0
  const overlayEnd = (startSeconds ?? 0) + (overlaySeconds ?? 0)
  const domain = clipSeconds ?? MAX_OVERLAY_SECONDS
  domainRef.current = domain

  return (
    <div className="create">
      <style>{css}</style>

      <header className="head">
        <h1>Create</h1>
        <span className="head-note">On device</span>
      </header>

      <div className="stage">
        <button
          type="button"
          className="preview-hit"
          disabled={!session || exporting}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={togglePlay}
        >
          <canvas ref={canvasRef} className="preview" />
          {!playing && !exporting && (
            <span className="preview-glyph" aria-hidden="true">
              ▶
            </span>
          )}
        </button>
      </div>

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
          />
          <div className="timing-read">
            <span>{startSeconds.toFixed(1)}s</span>
            <span className="timing-len">overlay · {overlaySeconds.toFixed(1)}s</span>
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
        <button type="button" className="btn" disabled={!session || busy} onClick={onExport}>
          Export mp4 · {seconds.toFixed(1)}s
        </button>
      )}

      {result && (
        <a className="btn-ghost btn-block" href={result.url} download="cyclemetry.mp4">
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
  aspect-ratio: ${OUT_W} / ${OUT_H};
  background: #1C1C1C;
}
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
.scrub { padding: 12px 0; touch-action: none; }
.scrub-off { opacity: 0.4; pointer-events: none; }
.scrub-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: #242424;
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
  top: -5px;
  left: 0;
  width: 2px;
  height: 16px;
  border-radius: 1px;
  background: #FAFAFA;
  opacity: 0.75;
  pointer-events: none;
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

.export { display: flex; flex-direction: column; gap: 8px; }
.bar { height: 6px; border-radius: 3px; background: #242424; overflow: hidden; }
.bar-fill { height: 100%; background: #DC143C; transition: width 150ms ease-out; }
.export-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
`
