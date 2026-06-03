// ─────────────────────────────────────────────────────────────────────────────
// timeline.ts — the ONE file you edit to tune the demo.
//
// The demo plays a single real screen recording (public/screen.mov) and speeds
// it up non-uniformly: fast through the boring parts, normal speed at the clicks.
// It also overlays synthetic click rings on top of the real cursor.
//
// All times below are in SOURCE seconds (where they land in your raw recording,
// i.e. what you see when scrubbing screen.mov), and all coordinates are in SOURCE
// pixels (the recording's native resolution — see recording.generated.ts WIDTH/HEIGHT).
// ─────────────────────────────────────────────────────────────────────────────
import { FPS, SOURCE_FRAMES, WIDTH, HEIGHT } from "./recording.generated";

// ── Output resolution ────────────────────────────────────────────────────────
// SCALE downscales the composition (1 = native recording res). Lower it if renders
// are slow; click coordinates below stay in source px and are scaled automatically.
export const SCALE = 1;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2); // h264 needs even dims
export const CANVAS_W = even(WIDTH * SCALE);
export const CANVAS_H = even(HEIGHT * SCALE);

// ── Speed remap ───────────────────────────────────────────────────────────────
// DEFAULT_SPEED applies everywhere not covered by a segment below.
// 2 = twice as fast. Use SEGMENTS to drop back to 1 (real time) around key clicks,
// or to blast (e.g. 4) through long boring stretches like scrolling a file list.
export const DEFAULT_SPEED = 2;

export type SpeedSegment = { fromSec: number; toSec: number; speed: number };
export const SEGMENTS: SpeedSegment[] = [
  // Example — tune these to your recording once you've scrubbed it:
  // { fromSec: 0.0,  toSec: 1.0,  speed: 1 },   // ease in at real time
  // { fromSec: 8.0,  toSec: 12.0, speed: 4 },   // blast through file-list scrolling
  // { fromSec: 12.0, toSec: 14.0, speed: 1 },   // normal speed on the important click
];

// ── Click rings ─────────────────────────────────────────────────────────────-
// Synthetic pulse drawn on top of the real cursor at the moment of each click.
// sec = SOURCE time of the click; x,y = SOURCE pixel position of the cursor tip.
export type Click = { sec: number; x: number; y: number };
export const CLICKS: Click[] = [
  // { sec: 1.4,  x: 690, y: 320 },
  // { sec: 5.2,  x: 980, y: 540 },
];

export const RING_DUR_SEC = 0.45; // how long each ring animates (source time)

// ─────────────────────────────────────────────────────────────────────────────
// Below here is machinery — you shouldn't need to touch it.
// ─────────────────────────────────────────────────────────────────────────────

function speedAtSourceFrame(sf: number): number {
  const t = sf / FPS;
  for (const s of SEGMENTS) {
    if (t >= s.fromSec && t < s.toSec) return s.speed;
  }
  return DEFAULT_SPEED;
}

// Build the output-frame → source-frame map once. Each source frame occupies
// (1 / speed) output frames, so faster segments consume fewer output frames.
function buildFrameMap(): number[] {
  const map: number[] = [];
  let acc = 0;
  for (let sf = 0; sf < SOURCE_FRAMES; sf++) {
    acc += 1 / Math.max(0.01, speedAtSourceFrame(sf));
    const target = Math.round(acc);
    while (map.length < target) map.push(sf);
  }
  if (map.length === 0) map.push(0);
  return map;
}

export const FRAME_MAP = buildFrameMap();
export const DURATION_IN_FRAMES = FRAME_MAP.length;
export const OUTPUT_FPS = FPS; // keep composition fps == source fps so startFrom math is 1:1

// Source frame shown at a given output (composition) frame.
export function sourceFrameAt(outFrame: number): number {
  const i = Math.max(0, Math.min(Math.round(outFrame), FRAME_MAP.length - 1));
  return FRAME_MAP[i];
}

// OffthreadVideo shows source frame = (compFrame + startFrom) at playbackRate 1.
// So to show sourceFrameAt(f) we pass startFrom = sourceFrameAt(f) - f (clamped ≥ 0).
export function startFromAt(outFrame: number): number {
  return Math.max(0, sourceFrameAt(outFrame) - Math.round(outFrame));
}
