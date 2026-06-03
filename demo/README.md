# Demo

Remotion animation of the Cyclemetry app. **You don't record it yourself.**
`record.py` drives the *real* app (real native dialogs, real Rust render) while
auto-recording the app window — with the real system cursor — to
`public/screen.mov`, then generates the speed timeline straight from the actions
it performed. Remotion time-remaps the footage: fast through the boring parts,
real-time at each click/hover/drag. Output is `out/demo.mp4`.

## Why this works

The footage is the actual app — cursor, clicks, and UI transitions are always in
sync because they're the same pixels. And because `record.py` *performs* every
action, the slow-at-action speed ramps are generated, not hand-tuned. No manual
recording, no eyeballing timestamps, no drift.

## Workflow

```bash
# 1. Open Cyclemetry first (the app must be running)
pnpm dev                      # from the repo root

# 2. Drive + record + generate timeline  (one command)
python3 demo/record.py        # first run: build your action sequence (~30s)

# 3. Render
npm start                     # Remotion Studio — live preview while you tweak
npm run render                # out/demo.mp4
npm run render:gif            # out/demo.gif
```

### First run: build the sequence

The first run (or `python3 demo/record.py recal`) opens a free-form builder where
you compose your own steps — there's no fixed storyboard. Point the mouse and press:

| key | action |
|---|---|
| `c` | click here |
| `h` | hover/dwell here |
| `d` | drag **start** (grab point) |
| `e` | drag **end** (release point) — pairs with the preceding `d` |
| `u` | undo last step |
| `g` | done — record & generate |
| `q` | quit |

The sequence is saved to `storyboard.coords.json` and replayed verbatim on later
runs, so making a fresh demo afterward is a single command. Rebuild it whenever
you want different steps, or when the app's layout / window size changes.

### Requirements

- macOS with `ffmpeg` (`brew install ffmpeg`).
- **Screen Recording** and **Accessibility** permission for your terminal
  (System Settings → Privacy & Security) — needed to capture the screen and to
  drive the mouse.

## Tuning

**Cursor speed** — how fast the cursor travels between points is set at *record
time* by `MOVE_DUR` in `record.py` (smaller = snappier). Change it and re-record.

Generated values land in `src/timeline.generated.ts` (don't edit by hand). For
playback tweaks, edit `src/timeline.ts` (no re-record needed — just re-render):

- `GEN_SYNC_OFFSET` (in `timeline.generated.ts`) — if the slow-down windows feel
  early or late, nudge by ±0.1s.
- `MANUAL_SEGMENTS` — hand-add speed ramps on top of the generated ones.
- `GEN_DEFAULT_SPEED` — global speed-up multiplier for the boring stretches.
- `SCALE` — downscale the output if renders are slow.

## How the time-remap works

`timeline.ts` builds an output-frame → source-frame map: each source frame
occupies `1 / speed` output frames, so faster segments consume fewer output
frames. `Demo.tsx` feeds `OffthreadVideo` a per-frame `startFrom`
(= `sourceFrame − outputFrame`), exactly how Remotion seeks the source for a
given composition frame. Composition fps is kept equal to source fps so the math
stays 1:1.

## Files

| File | Role |
|---|---|
| `record.py` | **the entry point** — drives the app, records, generates the timeline |
| `storyboard.coords.json` | your saved action sequence (reused across runs) |
| `public/screen.mov` | auto-recorded footage (gitignored; regenerated each run) |
| `probe.py` | reads the recording → `src/recording.generated.ts` |
| `src/recording.generated.ts` | auto: source dims / fps / length |
| `src/timeline.generated.ts` | auto: speed segments |
| `src/timeline.ts` | manual tuning knobs (sync offset, scale, overrides) |
| `src/Demo.tsx` | composition: remapped video |
| `src/Root.tsx` | wires composition dims / fps / duration |
