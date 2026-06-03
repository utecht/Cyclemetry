#!/usr/bin/env python3
"""
Coord capture HUD for Demo.tsx — hover over the running Tauri app, record wc() points.

Usage:
  python3 demo/coord-capture.py

Workflow:
  1. Run the Tauri app (pnpm dev).
  2. Press [o] to auto-detect the Cyclemetry window origin (no mouse positioning needed).
  3. Hover over any UI element, press [r], type a label, press Enter.
     (mouse position is captured at the moment you press [r], before you type)
  4. Press [c] to copy all const declarations to clipboard.
  5. Press [q] to quit.
"""

import curses
import sys
import subprocess
import ctypes

try:
    import Quartz
    HAS_QUARTZ = True
except ImportError:
    HAS_QUARTZ = False

# ── Mouse position via CoreGraphics (no pip packages needed) ───────────────

class _CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

try:
    _CG = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    _CG.CGEventCreate.restype = ctypes.c_void_p
    _CG.CGEventCreate.argtypes = [ctypes.c_void_p]
    _CG.CGEventGetLocation.restype = _CGPoint
    _CG.CGEventGetLocation.argtypes = [ctypes.c_void_p]
    _CG.CFRelease.restype = None
    _CG.CFRelease.argtypes = [ctypes.c_void_p]

    def get_mouse() -> tuple[int, int]:
        ev = _CG.CGEventCreate(None)
        pt = _CG.CGEventGetLocation(ev)
        _CG.CFRelease(ev)
        return int(pt.x), int(pt.y)

    get_mouse()  # smoke-test
except Exception as e:
    print(f"Error loading CoreGraphics: {e}")
    sys.exit(1)

# ── Window detection ───────────────────────────────────────────────────────

def get_win():
    if not HAS_QUARTZ:
        return None
    opts = (Quartz.kCGWindowListOptionOnScreenOnly |
            Quartz.kCGWindowListExcludeDesktopElements)
    for w in Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID):
        name = str(w.get("kCGWindowOwnerName", "")).lower()
        if "cyclemetry" in name and w.get("kCGWindowLayer", 99) == 0:
            b = w["kCGWindowBounds"]
            return int(b["X"]), int(b["Y"])
    return None

# ── Helpers ────────────────────────────────────────────────────────────────

WIN_W = 1448  # logical window width (matches Demo.tsx)

def point_to_code(label: str, wx: int, wy: int) -> str:
    return f"const {label:<16} = wc({wx}, {wy});"

def pbcopy(text: str) -> None:
    subprocess.run(["pbcopy"], input=text.encode(), check=True)

# ── Curses UI ──────────────────────────────────────────────────────────────

def main(scr: "curses._CursesWindow") -> None:
    curses.curs_set(0)
    scr.timeout(80)  # non-blocking getch, poll mouse ~12×/s
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_RED,   -1)   # accent
    curses.init_pair(2, curses.COLOR_CYAN,  -1)   # live coords
    curses.init_pair(3, curses.COLOR_GREEN, -1)   # success / recorded points
    curses.init_pair(4, curses.COLOR_WHITE, -1)   # normal

    RED   = curses.color_pair(1)
    CYAN  = curses.color_pair(2)
    GREEN = curses.color_pair(3)
    DIM   = curses.A_DIM
    BOLD  = curses.A_BOLD

    origin: tuple[int, int] | None = None
    points: list[tuple[str, int, int]] = []
    status: str = ""
    status_ttl: int = 0

    def flash(msg: str) -> None:
        nonlocal status, status_ttl
        status = msg
        status_ttl = 20  # ~1.6 s

    while True:
        sx, sy = get_mouse()
        h, w = scr.getmaxyx()
        W = min(w - 1, 56)

        scr.erase()

        def put(row: int, col: int, text: str, attr: int = 0) -> None:
            try:
                scr.addstr(row, col, text, attr)
            except curses.error:
                pass

        # header
        put(0, 0, "━" * W, RED)
        put(1, 2, "COORD CAPTURE", BOLD)
        put(1, 18, "Demo.tsx", DIM)
        put(2, 0, "━" * W, RED)

        # live coords
        put(4, 2, f"screen  ({sx:5d}, {sy:5d})", DIM)
        if origin:
            wx = sx - origin[0]
            wy = sy - origin[1]
            put(5, 2, f"window  ({wx:5d}, {wy:5d})", CYAN)
            put(6, 2, f"wc({wx}, {wy})", RED | BOLD)
        else:
            put(5, 2, "window  — press [o] to set origin", DIM)

        # recorded points
        put(8, 0, "─" * W, DIM)
        if points:
            for i, (lbl, pwx, pwy) in enumerate(points):
                if 9 + i >= h - 3:
                    break
                put(9 + i, 2, point_to_code(lbl, pwx, pwy), GREEN)
        else:
            put(9, 2, "no points yet", DIM)

        # controls / status bar
        put(h - 2, 0, "─" * W, DIM)
        if status and status_ttl > 0:
            put(h - 1, 2, status, GREEN)
            status_ttl -= 1
        else:
            put(h - 1, 1, "[o]rigin  [r]ecord  [c]opy all  [q]uit", DIM)

        scr.refresh()

        ch = scr.getch()

        if ch == ord("q"):
            break

        elif ch == ord("o"):
            win = get_win()
            if win:
                origin = win
                flash(f"✓ origin auto-detected at ({win[0]}, {win[1]})")
            else:
                origin = (sx, sy)
                flash(f"✓ origin set at mouse ({sx}, {sy}) — Cyclemetry not found")

        elif ch == ord("r"):
            if not origin:
                flash("Set origin first — press [o]")
                continue
            # Capture position NOW before the user moves the mouse to type
            cap_sx, cap_sy = get_mouse()
            cap_wx = cap_sx - origin[0]
            cap_wy = cap_sy - origin[1]

            # Prompt for label inline
            curses.echo()
            curses.curs_set(1)
            put(h - 1, 0, " " * W)
            put(h - 1, 2, "label: ", BOLD)
            scr.clrtoeol()
            scr.refresh()
            try:
                raw = scr.getstr(h - 1, 9, 24)
                label = raw.decode().strip().upper() or f"PT_{len(points) + 1}"
            except Exception:
                label = f"PT_{len(points) + 1}"
            finally:
                curses.noecho()
                curses.curs_set(0)

            points.append((label, cap_wx, cap_wy))
            flash(f"✓ {label} = wc({cap_wx}, {cap_wy})")

        elif ch == ord("c"):
            if not points:
                flash("No points to copy yet")
            else:
                pbcopy("\n".join(point_to_code(l, x, y) for l, x, y in points))
                flash(f"✓ {len(points)} point(s) copied to clipboard")


if __name__ == "__main__":
    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        pass
