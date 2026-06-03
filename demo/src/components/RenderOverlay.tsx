import React from "react";

const C = {
  bg: "#09090B",
  surface: "#18181B",
  border: "#27272A",
  border2: "#3F3F46",
  dim: "#52525B",
  muted: "#A1A1AA",
  text: "#FAFAFA",
  accent: "#DC143C",
};

export const RenderOverlay: React.FC<{ progress: number; opacity?: number }> = ({
  progress,
  opacity = 1,
}) => {
  const pct = Math.round(progress * 100);
  const finalizing = pct >= 100;

  const elapsedSec = (progress * 14).toFixed(0);
  const remainSec = finalizing ? 0 : Math.ceil((1 - progress) * 14);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9,9,11,0.9)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        zIndex: 100,
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: 360,
          background: C.surface,
          borderRadius: 14,
          border: `1px solid ${C.border2}`,
          padding: 32,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
        }}
      >
        {/* Spinning icon */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: `${C.accent}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <svg
            width={36}
            height={36}
            viewBox="0 0 36 36"
            style={{
              position: "absolute",
              transform: `rotate(${progress * 720}deg)`,
            }}
          >
            <circle cx="18" cy="18" r="15" stroke={C.border2} strokeWidth={3} fill="none" />
            <path
              d={`M18 3 A15 15 0 ${progress > 0.5 ? 1 : 0} 1 ${
                18 + 15 * Math.sin(progress * Math.PI * 2)
              } ${18 - 15 * Math.cos(progress * Math.PI * 2)}`}
              stroke={C.accent}
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
            />
          </svg>
          <svg width={20} height={20} viewBox="0 0 24 24" fill={C.accent} opacity={0.5}>
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
            {finalizing ? "Finalizing Video" : "Generating Video"}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
            {finalizing
              ? "Encoding output file…"
              : `${elapsedSec}s / 14s of overlay rendered`}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              marginBottom: 6,
            }}
          >
            <span style={{ color: C.accent, fontWeight: 600 }}>{pct}%</span>
            {!finalizing && (
              <span style={{ color: C.dim, fontFamily: "monospace" }}>
                {remainSec}s remaining
              </span>
            )}
          </div>
          <div
            style={{
              height: 6,
              background: C.border,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: C.accent,
                borderRadius: 3,
                transition: "width 0.1s linear",
              }}
            />
          </div>
        </div>

        {/* Cancel button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            paddingLeft: 16,
            paddingRight: 16,
            borderRadius: 6,
            border: `1px solid ${C.border2}`,
            color: C.muted,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
          </svg>
          Cancel
        </div>

        <div style={{ fontSize: 10, color: C.dim, fontStyle: "italic" }}>
          Keep the app open during rendering
        </div>
      </div>
    </div>
  );
};
