import React from "react";
import {
  useCurrentFrame,
  interpolate,
  Img,
  Easing,
  staticFile,
  OffthreadVideo,
} from "remotion";

// ── Coordinate helpers ──────────────────────────────────────────────────────
// Window: 1448×823 logical px  |  Canvas: 1280×720
const S = 1280 / 1448;
function wc(wx: number, wy: number) {
  return { x: wx * S, y: wy * S };
}

// Cursor waypoints (window-relative logical px → canvas px)
// Screen coords minus window origin (215, 130)
const PARK         = wc(724, 411);   // window center — idle
const TEMPLATE     = wc(128,  31);   // template picker button
const SAFA_INSTALL = wc(800, 429);   // Safa "Install" btn in community section
const INST_SAFA    = wc(493, 248);   // Safa card in Installed section (after install)
const ACTIVITY     = wc(280,  25);   // activity button
const BAKERCITY    = wc(202, 156);   // bakercity row in activity picker
const RENDER       = wc(1373, 34);   // render button

const CLICK_DUR = 6;

// ── Frame constants (240 frames = 8s @ 30fps) ───────────────────────────────
const F = {
  moveToTemplate:  [10, 22]  as [number, number],
  clickTemplate:   22,
  pickerOpen:      28,
  moveToInstall:   [28, 42]  as [number, number],
  clickInstall:    44,
  safaInstalled:   56,
  moveToInstalled: [56, 68]  as [number, number],
  clickInstalled:  70,
  safaLoaded:      78,
  moveToActivity:  [78, 90]  as [number, number],
  clickActivity:   92,
  actPicker:       98,
  moveToBaker:     [98, 110] as [number, number],
  clickBaker:      112,
  actLoaded:       120,
  moveToRender:    [120, 132] as [number, number],
  hoverRender:     132,
  clickRender:     134,
  renderStart:     140,
  renderDone:      186,   // 46 frames ≈ 1.53s for 0→100% progress
  videoFade:       192,
  videoPlay:       200,
};
// Root.tsx durationInFrames should be 240

// ── Shot mapping ────────────────────────────────────────────────────────────
function getShot(frame: number): string {
  if (frame >= F.renderStart)   return staticFile("shots/10_hover_render.png");
  if (frame >= F.actLoaded)     return staticFile("shots/09_gpx_loaded.png");
  if (frame >= F.actPicker)     return staticFile("shots/08_activity_picker.png");
  if (frame >= F.clickActivity) return staticFile("shots/07_hover_activity.png");
  if (frame >= F.safaLoaded)    return staticFile("shots/06_safa_loaded.png");
  if (frame >= F.safaInstalled) return staticFile("shots/05_safa_installed.png");
  if (frame >= F.clickInstall)  return staticFile("shots/04_hover_safa_install.png");
  if (frame >= F.pickerOpen)    return staticFile("shots/03_picker_open.png");
  if (frame >= F.clickTemplate) return staticFile("shots/02_hover_template.png");
  return staticFile("shots/01_idle.png");
}

// ── Cursor position ─────────────────────────────────────────────────────────
function getCursor(frame: number): { x: number; y: number } {
  const ease = Easing.bezier(0.25, 0.1, 0.25, 1.0);
  function lerp(
    f0: number, f1: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number }
  ) {
    const t = interpolate(frame, [f0, f1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
  }

  if (frame <= F.moveToTemplate[1])  return lerp(...F.moveToTemplate, PARK, TEMPLATE);
  if (frame <= F.moveToInstall[1])   return lerp(...F.moveToInstall, TEMPLATE, SAFA_INSTALL);
  if (frame <= F.safaInstalled)      return SAFA_INSTALL;
  if (frame <= F.moveToInstalled[1]) return lerp(...F.moveToInstalled, SAFA_INSTALL, INST_SAFA);
  if (frame <= F.safaLoaded)         return INST_SAFA;
  if (frame <= F.moveToActivity[1])  return lerp(...F.moveToActivity, INST_SAFA, ACTIVITY);
  if (frame <= F.actPicker)          return ACTIVITY;
  if (frame <= F.moveToBaker[1])     return lerp(...F.moveToBaker, ACTIVITY, BAKERCITY);
  if (frame <= F.actLoaded)          return BAKERCITY;
  if (frame <= F.moveToRender[1])    return lerp(...F.moveToRender, BAKERCITY, RENDER);
  return RENDER;
}

// ── Click pulse ─────────────────────────────────────────────────────────────
function getClickScale(frame: number): number {
  const clicks = [
    F.clickTemplate, F.clickInstall, F.clickInstalled,
    F.clickActivity, F.clickBaker, F.clickRender,
  ];
  for (const cf of clicks) {
    if (frame >= cf && frame < cf + CLICK_DUR) {
      return 1 - 0.22 * Math.sin(((frame - cf) / CLICK_DUR) * Math.PI);
    }
  }
  return 1;
}

// ── Cursor SVG ──────────────────────────────────────────────────────────────
const Cursor: React.FC<{ x: number; y: number; scale?: number; opacity?: number }> = ({
  x, y, scale = 1, opacity = 1,
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      pointerEvents: "none",
      transform: `scale(${scale})`,
      transformOrigin: "4px 2px",
      opacity,
    }}
  >
    <svg width={26} height={30} viewBox="0 0 26 30" fill="none">
      <path
        d="M4 2L4 24L9 18.5L12.5 27L15.5 25.5L12 17H19.5L4 2Z"
        fill="white"
        stroke="#1a1a1a"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

// ── Render progress overlay ─────────────────────────────────────────────────
const RenderOverlay: React.FC<{ progress: number }> = ({ progress }) => {
  const pct = Math.round(progress * 100);
  const frameNum = Math.round(progress * 272);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9,9,11,0.82)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
    >
      <div
        style={{
          width: 440,
          background: "#18181B",
          border: "1px solid #3F3F46",
          borderRadius: 14,
          padding: "28px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div style={{ color: "#FAFAFA", fontSize: 15, fontWeight: 600 }}>
          Generating Video
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              width: "100%",
              height: 6,
              background: "#27272A",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: "#DC143C",
                borderRadius: 3,
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#A1A1AA", fontSize: 11 }}>
              Frame {frameNum} / 272
            </span>
            <span style={{ color: "#A1A1AA", fontSize: 11 }}>{pct}%</span>
          </div>
        </div>

        {/* Cancel button */}
        <div
          style={{
            alignSelf: "center",
            padding: "6px 16px",
            border: "1px solid #3F3F46",
            borderRadius: 8,
            color: "#71717A",
            fontSize: 12,
            cursor: "default",
          }}
        >
          Cancel
        </div>
      </div>
    </div>
  );
};

// ── Main composition ────────────────────────────────────────────────────────
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();

  const shot         = getShot(frame);
  const pos          = getCursor(frame);
  const clickScale   = getClickScale(frame);

  const fadeIn       = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  const renderProgress = interpolate(frame, [F.renderStart, F.renderDone], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const videoOpacity = interpolate(frame, [F.videoFade, F.videoPlay], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorOpacity = interpolate(frame, [F.videoFade, F.videoPlay], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const overlayOpacity =
    frame >= F.videoFade
      ? interpolate(frame, [F.videoFade, F.videoPlay], [1, 0], {
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <div
      style={{
        width: 1280,
        height: 720,
        overflow: "hidden",
        position: "relative",
        background: "#000",
        opacity: fadeIn,
      }}
    >
      {/* App screenshot */}
      <Img
        src={shot}
        style={{
          width: 1280,
          height: "auto",
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
        }}
      />

      {/* Render progress overlay */}
      {frame >= F.renderStart && frame < F.videoPlay && (
        <div style={{ opacity: overlayOpacity }}>
          <RenderOverlay progress={renderProgress} />
        </div>
      )}

      {/* Final video fades in after render completes */}
      {frame >= F.videoFade && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: videoOpacity,
          }}
        >
          <OffthreadVideo
            src={staticFile("demo_vid.mov")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}

      {/* Animated cursor (fades out when video appears) */}
      <Cursor x={pos.x} y={pos.y} scale={clickScale} opacity={cursorOpacity} />
    </div>
  );
};
