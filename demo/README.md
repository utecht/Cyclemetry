# Demo

Remotion animation of the Cyclemetry app. Instead of stitching static screenshots
together with a synthetic cursor, the demo plays **one real screen recording** of
the app, time-remapped (fast through the boring parts, normal speed at the clicks)
with synthetic click rings drawn over the real cursor. Output is `out/demo.mp4`.

## Why a recording instead of screenshots

The old pipeline drove the app, captured numbered screenshots, and animated a fake
cursor on top — three independently hand-tuned timelines (cursor position, click
pulse, screenshot swap) that constantly drifted out of sync, so clicks landed in the
wrong place at the wrong moment. A real recording keeps the cursor, the clicks, and
the UI transitions perfectly in sync because they're the same footage.

## Workflow

### 1. Record the app

1. Open Cyclemetry (`pnpm dev` or the built app).
2. Screen-record the full session you want to show (open template → open activity →
   trim → click render → final video plays). ⌘⇧5 → record the app window, or use
   QuickTime. Move deliberately; you can speed it up later, so err on the slow side.
3. Save the recording as **`public/screen.mov`**.

### 2. Probe it

```bash
npm run probe        # or: python3 demo/probe.py
```

This reads the recording's resolution / fps / length and writes
`src/recording.generated.ts`, so the composition sizes itself to the footage.
Requires `ffprobe` (`brew install ffmpeg`).

### 3. Tune the timeline

Everything you edit lives in **`src/timeline.ts`**:

- `DEFAULT_SPEED` — global speed-up multiplier (2 = twice as fast).
- `SEGMENTS` — per-range speed overrides in **source seconds**. Drop back to `speed: 1`
  around the important clicks, or blast (`speed: 4`) through long boring stretches.
- `CLICKS` — `{ sec, x, y }` markers for the synthetic ring pulses. `sec` is the
  **source time** of the click; `x,y` are **source pixels** (the cursor tip).
- `SCALE` — downscale the output if renders are slow (click coords scale with it).

To find a click's `sec`/`x`/`y`: open the studio (`npm start`), scrub to the click,
read the source time, and eyeball the cursor position — or open the raw `screen.mov`
in any player.

### 4. Render

```bash
npm start            # Remotion Studio — scrub + live preview while tuning
npm run render       # out/demo.mp4
npm run render:gif   # out/demo.gif
```

## How the time-remap works

`timeline.ts` builds an output-frame → source-frame map: each source frame occupies
`1 / speed` output frames, so faster segments consume fewer output frames. `Demo.tsx`
then feeds `OffthreadVideo` a per-frame `startFrom` (= `sourceFrame − outputFrame`),
which is exactly how Remotion seeks the source for a given composition frame. The
composition fps is kept equal to the source fps so that math stays 1:1.

## Files

| File | Role |
|---|---|
| `public/screen.mov` | the raw recording (you provide this) |
| `probe.py` | reads the recording → `src/recording.generated.ts` |
| `src/recording.generated.ts` | auto-generated source dims / fps / length |
| `src/timeline.ts` | **the one file you edit** — speed segments, clicks, scale |
| `src/Demo.tsx` | composition: remapped video + click rings |
| `src/Root.tsx` | wires composition dims / fps / duration |

> The old screenshot-based scripts (`gen.py`, `capture.py`, `coord-capture.py`) and
> `public/shots/` are superseded by this flow and can be deleted.
