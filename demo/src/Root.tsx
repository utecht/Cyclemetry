import { Composition } from "remotion";
import { Demo } from "./Demo";
import { CANVAS_W, CANVAS_H, OUTPUT_FPS, DURATION_IN_FRAMES } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={DURATION_IN_FRAMES}
    fps={OUTPUT_FPS}
    width={CANVAS_W}
    height={CANVAS_H}
    defaultProps={{}}
  />
);
