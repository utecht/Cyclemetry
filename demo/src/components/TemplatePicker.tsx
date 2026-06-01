import React from "react";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const imgs: Record<string, string> = {
  safa: require("../../public/safa.jpg"),
  norcal: require("../../public/norcal.jpg"),
  will: require("../../public/will.jpg"),
  jeff: require("../../public/jeff.jpg"),
  aaron: require("../../public/aaron.jpg"),
  crit: require("../../public/crit.jpg"),
};

const C = {
  bg: "#09090B",
  surface: "#18181B",
  surface2: "#1F1F23",
  border: "#27272A",
  border2: "#3F3F46",
  dim: "#52525B",
  muted: "#A1A1AA",
  text: "#FAFAFA",
  accent: "#DC143C",
};

const TEMPLATES = [
  { id: "safa", name: "Safa" },
  { id: "norcal", name: "NorCal" },
  { id: "will", name: "Will" },
  { id: "jeff", name: "Jeff" },
  { id: "aaron", name: "Aaron" },
  { id: "crit", name: "Crit" },
];

export const TemplatePicker: React.FC<{
  opacity?: number;
  highlightId?: string;
}> = ({ opacity = 1, highlightId }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "rgba(9,9,11,0.85)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity,
      zIndex: 50,
    }}
  >
    <div
      style={{
        width: 720,
        background: C.surface,
        borderRadius: 14,
        border: `1px solid ${C.border2}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}
    >
      {/* Modal header */}
      <div
        style={{
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
            Templates
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
            Choose a starting point
          </div>
        </div>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          padding: 20,
        }}
      >
        {TEMPLATES.map((t) => {
          const active = highlightId === t.id;
          return (
            <div
              key={t.id}
              style={{
                borderRadius: 10,
                border: `2px solid ${active ? C.accent : C.border}`,
                overflow: "hidden",
                cursor: "pointer",
                background: C.bg,
                boxShadow: active ? `0 0 16px ${C.accent}44` : "none",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden" }}>
                <img
                  src={imgs[t.id]}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `${C.accent}22`,
                    }}
                  />
                )}
              </div>
              <div
                style={{
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 500, color: active ? C.text : C.muted }}>
                  {t.name}
                </span>
                {active && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: C.accent,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Active
                  </span>
                )}
                {!active && (
                  <span
                    style={{
                      fontSize: 9,
                      color: C.dim,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    Built-in
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </div>
);
