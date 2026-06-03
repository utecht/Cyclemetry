import React from "react";
import {
  AbsoluteFill,
  Easing,
  Freeze,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {
  CANVAS_W,
  CANVAS_H,
  MAIN_DURATION_IN_FRAMES,
  OUTRO_DURATION_IN_FRAMES,
  OUTRO_REVEAL_IN_FRAMES,
  OUTRO_VIDEO_FILE,
  startFromAt,
} from "./timeline";

// ── Main composition ──────────────────────────────────────────────────────────
// Plays the real screen recording (with the system cursor), time-remapped via a
// per-frame startFrom so it runs fast through the boring parts and real-time at
// each click/hover/drag.
export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const mainFrame = Math.min(frame, MAIN_DURATION_IN_FRAMES - 1);
  const startFrom = startFromAt(mainFrame);
  const outroFrame = frame - MAIN_DURATION_IN_FRAMES;
  const outroProgress =
    outroFrame < 0
      ? 0
      : interpolate(
          outroFrame,
          [0, OUTRO_REVEAL_IN_FRAMES],
          [0, 1],
          {
            easing: Easing.bezier(0.23, 1, 0.32, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );
  const outroScale = interpolate(outroProgress, [0, 1], [0.985, 1]);
  const outroBlur = interpolate(outroProgress, [0, 1], [8, 0]);
  const appDim = interpolate(outroProgress, [0, 1], [0, 0.72]);

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {frame < MAIN_DURATION_IN_FRAMES ? (
        <OffthreadVideo
          src={staticFile("screen.mov")}
          startFrom={startFrom}
          style={{ width: CANVAS_W, height: CANVAS_H, objectFit: "fill" }}
        />
      ) : (
        <Freeze frame={MAIN_DURATION_IN_FRAMES - 1}>
          <OffthreadVideo
            src={staticFile("screen.mov")}
            startFrom={startFrom}
            style={{ width: CANVAS_W, height: CANVAS_H, objectFit: "fill" }}
          />
        </Freeze>
      )}
      {frame >= MAIN_DURATION_IN_FRAMES ? (
        <AbsoluteFill style={{ background: "#050505", opacity: appDim }} />
      ) : null}
      <Sequence
        from={MAIN_DURATION_IN_FRAMES}
        durationInFrames={OUTRO_DURATION_IN_FRAMES}
      >
        <OffthreadVideo
          src={staticFile(OUTRO_VIDEO_FILE)}
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            objectFit: "cover",
            opacity: outroProgress,
            transform: `scale(${outroScale})`,
            filter: `blur(${outroBlur}px)`,
          }}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export { CANVAS_W, CANVAS_H };
