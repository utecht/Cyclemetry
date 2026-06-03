import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  interpolate,
  Easing,
} from "remotion";
import { FPS } from "./recording.generated";
import {
  CANVAS_W,
  CANVAS_H,
  SCALE,
  CLICKS,
  RING_DUR_SEC,
  sourceFrameAt,
  startFromAt,
} from "./timeline";

// ── Click ring ───────────────────────────────────────────────────────────────
// A single expanding pulse drawn over the real cursor at each click moment.
const ClickRing: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) => {
  // t ∈ [0,1] across the ring's lifetime
  const radius = interpolate(t, [0, 1], [8, 42], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const opacity = interpolate(t, [0, 0.15, 1], [0, 0.5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: "50%",
        border: "3px solid #DC143C",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

// ── Main composition ──────────────────────────────────────────────────────────
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();

  const startFrom = startFromAt(frame);
  const sourceSec = sourceFrameAt(frame) / FPS;

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#000", opacity: fadeIn }}>
      {/* Real screen recording, time-remapped via dynamic startFrom */}
      <OffthreadVideo
        src={staticFile("screen.mov")}
        startFrom={startFrom}
        style={{ width: CANVAS_W, height: CANVAS_H, objectFit: "fill" }}
      />

      {/* Synthetic click rings, keyed to SOURCE time so they track the real cursor */}
      {CLICKS.map((c, i) => {
        const dt = sourceSec - c.sec;
        if (dt < 0 || dt > RING_DUR_SEC) return null;
        return (
          <ClickRing key={i} x={c.x * SCALE} y={c.y * SCALE} t={dt / RING_DUR_SEC} />
        );
      })}
    </AbsoluteFill>
  );
};

export { CANVAS_W, CANVAS_H };
