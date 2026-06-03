#!/usr/bin/env python3
"""
capture.py — Capture real Cyclemetry screenshots for the Remotion demo.
Run with the app open:  python3 demo/capture.py
"""
import sys, time, subprocess
from pathlib import Path

try:
    import Quartz
except ImportError:
    sys.exit("pip3 install pyobjc-framework-Quartz")

SHOTS = Path(__file__).parent / "public" / "shots"

SHOTS.mkdir(exist_ok=True)
for f in SHOTS.glob("*.png"):
    f.unlink()

# Remove any previously installed Safa so the demo can show the install flow
user_tmpl_dir = Path("/tmp/cyclemetry/templates")
if user_tmpl_dir.exists():
    for f in user_tmpl_dir.glob("safa*"):
        f.unlink()
        print(f"  🗑️  Removed {f.name}")

# ── Helpers ────────────────────────────────────────────────────────────────

def get_win():
    opts = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
    for w in Quartz.CGWindowListCopyWindowInfo(opts, Quartz.kCGNullWindowID):
        if "cyclemetry" in str(w.get("kCGWindowOwnerName", "")).lower() \
                and w.get("kCGWindowLayer", 99) == 0:
            b = w["kCGWindowBounds"]
            return w["kCGWindowNumber"], int(b["X"]), int(b["Y"]), int(b["Width"]), int(b["Height"])
    return None

def activate():
    subprocess.run(["osascript", "-e", 'tell application "Cyclemetry" to activate'],
                   capture_output=True)
    time.sleep(0.3)

def _cg(kind, x, y):
    pt = Quartz.CGPoint(x, y)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap,
        Quartz.CGEventCreateMouseEvent(None, kind, pt, Quartz.kCGMouseButtonLeft))

def move(x, y):
    _cg(Quartz.kCGEventMouseMoved, x, y)
    time.sleep(0.02)

def click(x, y):
    move(x, y)
    time.sleep(0.05)
    _cg(Quartz.kCGEventLeftMouseDown, x, y)
    time.sleep(0.08)
    _cg(Quartz.kCGEventLeftMouseUp, x, y)
    time.sleep(0.12)

def smooth(x0, y0, x1, y1, steps=22, dur=0.35):
    for i in range(steps + 1):
        t = i / steps
        t = t * t * (3 - 2 * t)
        move(int(x0 + (x1 - x0) * t), int(y0 + (y1 - y0) * t))
        time.sleep(dur / steps)

def shot(name):
    wid, *_ = get_win()
    path = str(SHOTS / f"{name}.png")
    subprocess.run(["screencapture", "-l", str(wid), "-o", path], capture_output=True)
    kb = (SHOTS / f"{name}.png").stat().st_size // 1024
    print(f"  📸  {name}.png  ({kb} KB)")

def esc():
    subprocess.run(["osascript", "-e",
        'tell application "System Events" to key code 53'], capture_output=True)
    time.sleep(0.35)

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    print("\n═══ Cyclemetry capture ═══\n")

    result = get_win()
    if not result:
        sys.exit("❌ Cyclemetry not found — open it first")
    wid, wx, wy, ww, wh = result
    print(f"Window #{wid}: ({wx},{wy}) {ww}×{wh}\n")

    activate()
    time.sleep(0.5)

    # Known header button positions (user-measured)
    X_TMPL   = 343   # template picker button
    X_ACT    = 495   # activity button
    X_RENDER = 1588  # render button
    HY       = 161   # all header buttons share this Y

    # ── Modal geometry ─────────────────────────────────────────────────────
    # Modal: w=720, centered horizontally in window
    ml = wx + (ww - 720) // 2   # modal left edge (screen x)

    # Card dimensions inside the 720px modal:
    #   grid: px-5=20px each side, gap-3=12px between 3 cols
    #   card_w = (720 - 40 - 24) / 3 = 218px
    #   aspect-video height = 218 * 9/16 = 122px
    card_w    = (720 - 40 - 24) // 3   # 218
    preview_h = card_w * 9 // 16        # 122

    # Community section: NO installed templates → modal height ≈ 446px
    #   header=60, body_pad=16, section_label=24, 2 rows × (preview_h + info_row=36) + gap=12
    modal_h_before = 60 + 16 + 24 + 2 * (preview_h + 36) + 12 + 16
    mt_before = wy + (wh - modal_h_before) // 2  # modal top (screen y)

    # Community grid top (inside body):  header + body_top_pad + label_height
    comm_grid_top = mt_before + 60 + 16 + 24

    # Disk scan order: crit(col1), safa(col2), will(col3), norcal(col1), jeff(col2), aaron(col3)
    # Safa = col2, row1
    safa_col2_left  = ml + 20 + card_w + 12          # left edge of col2 card
    safa_row1_top   = comm_grid_top                   # top of row 1
    safa_inforow_cy = safa_row1_top + preview_h + 18  # center of info row (py-2=8+8=16, half=18)
    # Install button: right-side of info row; ~50px wide, inner right = card_right - px-2.5=10
    safa_card_right  = safa_col2_left + card_w
    SAFA_INSTALL_SX  = safa_card_right - 25           # button center x
    SAFA_INSTALL_SY  = safa_inforow_cy

    # After install: 1 installed + 5 community → modal height ≈ 649px
    #   installed section: 24 + (preview_h+32) = 178px; space-y-6=24; community: 24 + 2*(preview_h+36)+12
    modal_h_after  = 60 + 16 + (24 + preview_h + 32) + 24 + (24 + 2*(preview_h+36)+12) + 16
    mt_after       = wy + max(0, (wh - modal_h_after) // 2)
    inst_grid_top  = mt_after + 60 + 16 + 24   # installed grid top after header + pad + label
    inst_col1_cx   = ml + 20 + card_w // 2     # installed Safa col1 center x
    INSTALLED_SX   = inst_col1_cx
    INSTALLED_SY   = inst_grid_top + preview_h // 2   # center of preview area

    # Activity picker: bakercity item (previously measured)
    BAKERCITY_SX = wx + 202
    BAKERCITY_SY = wy + 156

    print(f"  Modal before-install top: {mt_before}  (modal h={modal_h_before})")
    print(f"  Safa Install button:  ({SAFA_INSTALL_SX}, {SAFA_INSTALL_SY})")
    print(f"  Modal after-install top:  {mt_after}  (modal h={modal_h_after})")
    print(f"  Installed Safa card:  ({INSTALLED_SX}, {INSTALLED_SY})\n")

    # Park cursor, dismiss any open picker
    px, py = wx + ww // 2, wy + wh // 2
    move(px, py)
    esc()
    time.sleep(0.3)

    # ── [01] App at rest ────────────────────────────────────────────────────
    print("[1] App at rest")
    time.sleep(0.4)
    shot("01_idle")

    # ── [02] Hover template button ──────────────────────────────────────────
    print("[2] Hover template button")
    smooth(px, py, X_TMPL, HY, dur=0.5)
    time.sleep(0.15)
    shot("02_hover_template")

    # ── [03] Click → picker opens (community templates listed) ─────────────
    print("[3] Click → picker opens")
    click(X_TMPL, HY)
    time.sleep(0.9)
    shot("03_picker_open")

    # ── [04] Move to + hover Safa Install button ────────────────────────────
    print("[4] Hover Safa Install button")
    smooth(X_TMPL, HY, SAFA_INSTALL_SX, SAFA_INSTALL_SY, dur=0.55)
    time.sleep(0.15)
    shot("04_hover_safa_install")

    # ── [05] Click Install → wait for install + fetchTemplates ─────────────
    print("[5] Click Install → wait for install")
    click(SAFA_INSTALL_SX, SAFA_INSTALL_SY)
    time.sleep(1.8)   # installCommunityTemplate + fetchTemplates
    shot("05_safa_installed")

    # ── [06] Move to installed Safa card + click to load it ────────────────
    print("[6] Click installed Safa → template loads")
    smooth(SAFA_INSTALL_SX, SAFA_INSTALL_SY, INSTALLED_SX, INSTALLED_SY, dur=0.5)
    time.sleep(0.15)
    click(INSTALLED_SX, INSTALLED_SY)
    time.sleep(0.9)
    shot("06_safa_loaded")

    # ── [07] Hover activity button ──────────────────────────────────────────
    print("[7] Hover activity button")
    smooth(INSTALLED_SX, INSTALLED_SY, X_ACT, HY, dur=0.5)
    time.sleep(0.15)
    shot("07_hover_activity")

    # ── [08] Click activity → picker opens ─────────────────────────────────
    print("[8] Click activity → picker opens")
    click(X_ACT, HY)
    time.sleep(0.7)
    shot("08_activity_picker")

    # ── [09] Click bakercity → GPX loads ───────────────────────────────────
    print("[9] Click bakercity → GPX loads")
    click(BAKERCITY_SX, BAKERCITY_SY)
    time.sleep(1.2)
    shot("09_gpx_loaded")

    # ── [10] Hover render button ────────────────────────────────────────────
    print("[10] Hover render button")
    smooth(X_ACT, HY, X_RENDER, HY, dur=0.5)
    time.sleep(0.15)
    shot("10_hover_render")

    print("\n✅ Done! Remotion animates the render progress + final video.")
    for f in sorted(SHOTS.glob("*.png")):
        print(f"   {f.name}  ({f.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
