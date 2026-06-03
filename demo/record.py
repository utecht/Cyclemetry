#!/usr/bin/env python3
"""
record.py — Make the demo video WITHOUT recording it yourself.

It drives the REAL Cyclemetry app (real native dialogs, real Rust render) while
auto-recording the app window — with the real system cursor — to public/screen.mov,
then generates the slow-at-action speed ramps from the actions it performed.

    python3 demo/record.py            # build a sequence (if none saved) → record → generate
    python3 demo/record.py recal      # rebuild the sequence from scratch
    npm run render                    # out/demo.mp4

Sequence builder: you compose your own steps interactively — point the mouse and
press a key to append a click / hover / drag. There's no fixed storyboard.

How fast the cursor travels between points is set by MOVE_DUR below (smaller =
snappier). Re-record after changing it.

Requirements: macOS, ffmpeg (brew install ffmpeg), and Screen Recording +
Accessibility permission for your terminal (System Settings → Privacy & Security).
Open Cyclemetry (`pnpm dev` or the built app) before running.
"""

import curses
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

try:
    import Quartz
except ImportError:
    sys.exit("❌  pyobjc missing — run: pip3 install pyobjc-framework-Quartz")

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
SCREEN = ROOT / "public" / "screen.mov"
COORDS = ROOT / "storyboard.coords.json"
GEN_TL = ROOT / "src" / "timeline.generated.ts"
RECORDING_TS = ROOT / "src" / "recording.generated.ts"

# ── Motion / timeline tuning ──────────────────────────────────────────────────
MOVE_DUR = 0.16          # seconds to glide between points (smaller = faster cursor)
CLICK_SETTLE = 0.6       # pause after a click so the UI's reaction is visible
DEFAULT_SPEED = 2        # speed-up multiplier for the boring stretches
CLICK_PAD = 0.35         # real-time window on each side of a click (source sec)
HOVER_PAD = 0.4          # real-time window around a hover dwell
DRAG_LEAD, DRAG_TAIL = 0.15, 0.25  # real-time padding around a drag

# Event types the builder understands.  key → (type, label)
EVENTS = {
    "c": ("click",      "CLICK"),
    "h": ("hover",      "HOVER"),
    "d": ("drag_start", "DRAG ↓"),
    "e": ("drag_end",   "DRAG ↑"),
}

# ── Window / mouse ────────────────────────────────────────────────────────────
def get_win() -> tuple[int, int, int, int, int] | None:
    """Returns (window_id, x, y, w, h) of the Cyclemetry window, in points."""
    opts = (Quartz.kCGWindowListOptionOnScreenOnly |
            Quartz.kCGWindowListExcludeDesktopElements)
    for w in Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID):
        name = str(w.get("kCGWindowOwnerName", "")).lower()
        if "cyclemetry" in name and w.get("kCGWindowLayer", 99) == 0:
            b = w["kCGWindowBounds"]
            return (w["kCGWindowNumber"],
                    int(b["X"]), int(b["Y"]), int(b["Width"]), int(b["Height"]))
    return None

def get_mouse() -> tuple[int, int]:
    ev = Quartz.CGEventCreate(None)
    pt = Quartz.CGEventGetLocation(ev)
    return int(pt.x), int(pt.y)

def activate() -> None:
    """Bring the Cyclemetry window to the front so clicks land on it."""
    opts = (Quartz.kCGWindowListOptionOnScreenOnly |
            Quartz.kCGWindowListExcludeDesktopElements)
    for w in Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID):
        name = str(w.get("kCGWindowOwnerName", "")).lower()
        if "cyclemetry" in name and w.get("kCGWindowLayer", 99) == 0:
            pid = w.get("kCGWindowOwnerPID")
            if pid:
                subprocess.run(
                    ["osascript", "-e",
                     f'tell application "System Events" to set frontmost of '
                     f'first process whose unix id is {pid} to true'],
                    capture_output=True)
                time.sleep(0.3)
                return

# ── Mouse primitives ──────────────────────────────────────────────────────────
def _post(kind, x, y):
    evt = Quartz.CGEventCreateMouseEvent(
        None, kind, Quartz.CGPoint(x, y), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, evt)

def _move(x, y): _post(Quartz.kCGEventMouseMoved, x, y); time.sleep(0.005)
def _drag(x, y): _post(Quartz.kCGEventLeftMouseDragged, x, y); time.sleep(0.005)

def smooth(x0, y0, x1, y1, held=False, steps=22, dur=MOVE_DUR):
    """Glide the cursor x0,y0 → x1,y1 with smoothstep easing (looks human)."""
    fn = _drag if held else _move
    for i in range(steps + 1):
        t = i / steps
        t = t * t * (3 - 2 * t)
        fn(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t))
        time.sleep(dur / steps)

def click(sx, sy):
    _move(sx, sy);                               time.sleep(0.05)
    _post(Quartz.kCGEventLeftMouseDown, sx, sy);  time.sleep(0.08)
    _post(Quartz.kCGEventLeftMouseUp,   sx, sy);  time.sleep(0.12)

# ── Display / capture helpers ─────────────────────────────────────────────────
def retina_scale() -> float:
    """Physical-pixels-per-point of the main display (2.0 on Retina)."""
    did = Quartz.CGMainDisplayID()
    mode = Quartz.CGDisplayCopyDisplayMode(did)
    px, pt = Quartz.CGDisplayModeGetPixelWidth(mode), Quartz.CGDisplayModeGetWidth(mode)
    return (px / pt) if pt else 2.0

def avf_screen_index() -> str:
    """avfoundation device index for 'Capture screen 0'."""
    out = subprocess.run(
        ["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
        capture_output=True, text=True).stderr
    m = re.search(r"\[(\d+)\] Capture screen 0", out)
    return m.group(1) if m else "3"

# ── Sequence builder (free-form) ──────────────────────────────────────────────
def build_sequence() -> list[dict]:
    """Compose an arbitrary sequence of click/hover/drag events. The user points
    the mouse and presses a key to append each step. Returns [{type, wx, wy}]."""
    win = get_win()
    if not win:
        sys.exit("❌  Cyclemetry window not found — open the app first.")
    _, ox, oy, _, _ = win

    def _run(scr) -> list[dict]:
        curses.curs_set(0); scr.timeout(80)
        curses.start_color(); curses.use_default_colors()
        for i, c in enumerate((curses.COLOR_RED, curses.COLOR_CYAN,
                               curses.COLOR_GREEN, curses.COLOR_YELLOW), 1):
            curses.init_pair(i, c, -1)
        RED, CYAN, GREEN, YELLOW = (curses.color_pair(i) for i in (1, 2, 3, 4))
        BOLD, DIM = curses.A_BOLD, curses.A_DIM

        seq: list[dict] = []
        status, ttl = "", 0

        def flash(m):
            nonlocal status, ttl
            status, ttl = m, 30

        def drag_open() -> bool:
            return bool(seq) and seq[-1]["type"] == "drag_start"

        while True:
            sx, sy = get_mouse()
            wx, wy = sx - ox, sy - oy
            h, w = scr.getmaxyx()
            W = min(w - 1, 74)
            scr.erase()

            def put(r, c, t, a=0):
                try: scr.addstr(r, c, t[:W - c], a)
                except curses.error: pass

            put(0, 0, "━" * W, RED)
            put(1, 2, "BUILD SEQUENCE", BOLD); put(1, 18, f"origin ({ox},{oy})", DIM)
            put(2, 0, "━" * W, RED)
            put(4, 2, f"window ({wx:5d}, {wy:5d})", CYAN)
            put(4, 26, "drag open — press [e] to release" if drag_open() else "", YELLOW)

            put(6, 0, "─" * W, DIM)
            put(6, 2, f"sequence ({len(seq)})", DIM)
            shown = seq[-(h - 12):]
            base = len(seq) - len(shown)
            for rel, a in enumerate(shown):
                disp = next(v[1] for v in EVENTS.values() if v[0] == a["type"])
                col = YELLOW if "drag" in a["type"] else GREEN
                put(7 + rel, 2, f"{base+rel+1:02d}  {disp:<7} ({a['wx']}, {a['wy']})", col)

            put(h - 3, 0, "─" * W, DIM)
            put(h - 2, 1, "[c]lick  [h]over  [d]rag↓  [e]nd↑  [u]ndo  [g]o  [q]uit", DIM)
            if ttl > 0:
                put(h - 1, 2, status, GREEN); ttl -= 1
            scr.refresh()

            ch = scr.getch()
            key = chr(ch) if 0 < ch < 128 else ""
            if key == "q":
                return []
            elif key == "u":
                if seq: flash(f"removed {seq.pop()['type']}")
                else: flash("nothing to undo")
            elif key == "g":
                if not seq:
                    flash("add at least one step first")
                elif drag_open():
                    flash("close the open drag with [e] first")
                else:
                    return seq
            elif key in EVENTS:
                atype = EVENTS[key][0]
                if atype == "drag_end" and not drag_open():
                    flash("no open drag — press [d] first"); continue
                if atype != "drag_end" and drag_open():
                    flash("close the open drag with [e] first"); continue
                cx, cy = get_mouse()
                seq.append({"type": atype, "wx": cx - ox, "wy": cy - oy})
                flash(f"+ {atype}")

    return curses.wrapper(_run)

# ── Record + drive ────────────────────────────────────────────────────────────
def record_and_drive(seq: list[dict]):
    """Record the cropped window (with the system cursor) and drive `seq`.
    Returns (segments, win_w); segment times are measured from the recording's
    first encoded frame."""
    win = get_win()
    if not win:
        sys.exit("❌  Cyclemetry window not found — open the app first.")
    _, wx0, wy0, ww, wh = win
    scale = retina_scale()
    idx = avf_screen_index()

    cw = int(ww * scale) & ~1
    ch = int(wh * scale) & ~1
    cx, cy = int(wx0 * scale), int(wy0 * scale)

    SCREEN.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-f", "avfoundation",
           "-capture_cursor", "1", "-framerate", "60", "-i", f"{idx}:none",
           "-vf", f"crop={cw}:{ch}:{cx}:{cy}", "-c:v", "libx264",
           "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(SCREEN)]

    print(f"  🎥  recording screen {idx}, crop {cw}×{ch} @ ({cx},{cy})")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=False)

    first_frame = threading.Event()

    def _drain():
        fd = proc.stderr.fileno()
        buf = b""
        while True:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            if not first_frame.is_set() and b"frame=" in (buf + chunk):
                first_frame.set()
            buf = chunk[-16:]
    threading.Thread(target=_drain, daemon=True).start()

    if not first_frame.wait(timeout=15):
        proc.kill()
        sys.exit("❌  ffmpeg never started capturing — check Screen Recording "
                 "permission for your terminal in System Settings.")
    time.sleep(0.2)
    t0 = time.time()

    activate()
    print("  🤖  driving the app…")

    prev = (wx0 + ww // 2, wy0 + wh // 2)
    hold, drag_t0 = (0, 0), 0.0
    segments = []
    for a in seq:
        asx, asy = wx0 + a["wx"], wy0 + a["wy"]
        if a["type"] == "click":
            smooth(*prev, asx, asy)
            sec = time.time() - t0
            click(asx, asy)
            segments.append((sec - CLICK_PAD, sec + CLICK_PAD))
            time.sleep(CLICK_SETTLE)
            prev = (asx, asy)
        elif a["type"] == "hover":
            smooth(*prev, asx, asy)
            sec = time.time() - t0
            time.sleep(0.5)
            segments.append((sec - HOVER_PAD, (time.time() - t0) + 0.1))
            prev = (asx, asy)
        elif a["type"] == "drag_start":
            smooth(*prev, asx, asy)
            time.sleep(0.05)
            _post(Quartz.kCGEventLeftMouseDown, asx, asy)
            time.sleep(0.08)
            hold, drag_t0 = (asx, asy), time.time() - t0
            prev = (asx, asy)
        elif a["type"] == "drag_end":
            smooth(*hold, asx, asy, held=True)
            _post(Quartz.kCGEventLeftMouseUp, asx, asy)
            time.sleep(0.4)
            segments.append((drag_t0 - DRAG_LEAD, (time.time() - t0) + DRAG_TAIL))
            prev = (asx, asy)
    time.sleep(0.8)  # tail so the final state is visible

    try:
        proc.stdin.write(b"q"); proc.stdin.flush()
        proc.wait(timeout=20)
    except Exception:
        proc.terminate()
    print(f"  ✅  {SCREEN.relative_to(ROOT)} written")
    return segments, ww

# ── Timeline generation ───────────────────────────────────────────────────────
def write_timeline(segments) -> None:
    """Emit the slow-at-action speed segments derived from the driven actions."""
    seg_lines = [f"  {{ fromSec: {round(a, 3)}, toSec: {round(b, 3)}, speed: 1 }},"
                 for a, b in segments]
    GEN_TL.write_text(
        "// AUTO-GENERATED by record.py — do not edit by hand.\n"
        "// Speed segments derived from the actions record.py drove: real-time at\n"
        "// each click/hover/drag, DEFAULT_SPEED everywhere else.\n"
        "import type { SpeedSegment } from './timeline';\n\n"
        f"export const GEN_DEFAULT_SPEED = {DEFAULT_SPEED};\n\n"
        "// Seconds added to every segment. Nudge by ±0.1 and re-render if the\n"
        "// slow-down windows feel early or late relative to the cursor.\n"
        "export const GEN_SYNC_OFFSET = 0;\n\n"
        "export const GEN_SEGMENTS: SpeedSegment[] = [\n"
        + "\n".join(seg_lines) + "\n];\n")
    print(f"  📝  wrote {GEN_TL.relative_to(ROOT)} ({len(segments)} segments)")

# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    recal = "recal" in sys.argv[1:]
    if get_win() is None:
        sys.exit("❌  Cyclemetry window not found — open the app (pnpm dev) first.")

    if recal or not COORDS.exists():
        print("── build the action sequence " + "─" * 31)
        seq = build_sequence()
        if not seq:
            sys.exit("aborted.")
        COORDS.write_text(json.dumps({"actions": seq}, indent=2))
        print(f"  💾  saved {COORDS.relative_to(ROOT)} ({len(seq)} steps)")
    seq = json.loads(COORDS.read_text())["actions"]

    print("\n── recording the real app " + "─" * 34)
    segments, _ = record_and_drive(seq)

    print("\n── probing recording " + "─" * 39)
    if subprocess.run([sys.executable, str(ROOT / "probe.py")]).returncode != 0:
        sys.exit("❌  probe.py failed.")

    print("\n── generating timeline " + "─" * 37)
    write_timeline(segments)

    print("\n✅  Done. Preview with `npm start`, or render with `npm run render`.")


if __name__ == "__main__":
    main()
