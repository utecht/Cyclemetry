import React from "react";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const safaImg: string = require("../../public/safa.jpg");

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
  accentDim: "#7F0A22",
};

interface AppShellProps {
  templateName?: string;
  gpxName?: string;
  templateHighlight?: boolean;
  gpxHighlight?: boolean;
  renderHighlight?: boolean;
  showSafaOverlay?: boolean;
  children?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  templateName = "Safa",
  gpxName,
  templateHighlight = false,
  gpxHighlight = false,
  renderHighlight = false,
  showSafaOverlay = true,
  children,
}) => {
  const hasActivity = !!gpxName;

  return (
    <div
      style={{
        width: 1280,
        height: 720,
        background: C.bg,
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          height: 28,
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#FF5F57" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#FEBC2E" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#28C840" }} />
        </div>
        <span
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 11,
            color: C.muted,
            letterSpacing: "0.02em",
            fontWeight: 500,
            marginRight: 60,
          }}
        >
          Cyclemetry
        </span>
      </div>

      {/* Main toolbar */}
      <div
        style={{
          height: 40,
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
          paddingRight: 12,
          gap: 6,
          flexShrink: 0,
        }}
      >
        {/* Template button */}
        <HdrBtn
          icon={<GridIcon />}
          label={templateName}
          active={templateHighlight}
          dim={!templateName}
        />
        <Divider />

        {/* GPX / activity button */}
        <HdrBtn
          icon={<ActivityIcon />}
          label={gpxName || "Load Activity"}
          active={gpxHighlight}
          dim={!gpxName}
        />
        <Divider />

        {/* Video button */}
        <HdrBtn
          icon={<FilmIcon />}
          label="demo_vid.mov"
          active={false}
          dim={false}
        />
        <Divider />

        {/* Resolution */}
        <HdrBtn
          icon={<MonitorIcon />}
          label="1080p"
          active={false}
          dim={false}
        />

        <div style={{ flex: 1 }} />

        {/* Render button */}
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 6,
            border: `1px solid ${renderHighlight ? C.accent : C.accentDim}`,
            background: renderHighlight ? `${C.accent}33` : `${C.accent}22`,
            color: C.text,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: renderHighlight ? `0 0 12px ${C.accent}55` : "none",
            transition: "all 0.15s ease",
          }}
        >
          <PlayIcon />
          Render Video
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Left sidebar */}
        <div
          style={{
            width: 240,
            background: C.surface,
            borderRight: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: "10px 12px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: C.dim,
              textTransform: "uppercase",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            Elements
          </div>
          {showSafaOverlay && (
            <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { label: "speed [MPH]", type: "value" },
                { label: "speed [KMH]", type: "value" },
                { label: "power", type: "value" },
                { label: "elevation plot", type: "plot" },
                { label: "course map", type: "plot" },
                { label: "gradient", type: "value" },
              ].map((el, i) => (
                <ElementRow key={i} label={el.label} type={el.type} active={i === 0} />
              ))}
            </div>
          )}
        </div>

        {/* Center canvas */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: C.bg,
            position: "relative",
          }}
        >
          {showSafaOverlay ? (
            <div
              style={{
                width: 480,
                height: 270,
                borderRadius: 8,
                overflow: "hidden",
                border: `1px solid ${C.border2}`,
                position: "relative",
                background: "#111",
              }}
            >
              <img
                src={safaImg}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: 0.85,
                }}
              />
            </div>
          ) : (
            <div
              style={{
                color: C.dim,
                fontSize: 13,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <GridIcon size={24} color={C.border2} />
              <span>No template loaded</span>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div
          style={{
            width: 240,
            background: C.surface,
            borderLeft: `1px solid ${C.border}`,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "10px 12px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: C.dim,
              textTransform: "uppercase",
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            Properties
          </div>
          {showSafaOverlay && (
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              <PropRow label="Font" value="Evogria" />
              <PropRow label="Color" value="#f4f4f4" swatch />
              <PropRow label="Opacity" value="50%" />
              <PropRow label="Resolution" value="4K" />
              <PropRow label="Start" value="0:15" />
              <PropRow label="End" value="20:00" />
            </div>
          )}
        </div>
      </div>

      {children}
    </div>
  );
};

const HdrBtn: React.FC<{ icon: React.ReactNode; label: string; active: boolean; dim: boolean }> = ({
  icon, label, active, dim,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      height: 28,
      paddingLeft: 9,
      paddingRight: 9,
      borderRadius: 6,
      border: `1px solid ${active ? C.border2 : C.border}`,
      background: active ? C.surface2 : "transparent",
      color: dim ? C.dim : C.muted,
      fontSize: 12,
      cursor: "pointer",
      maxWidth: 160,
      overflow: "hidden",
      boxShadow: active ? `0 0 0 1px ${C.border2}` : "none",
    }}
  >
    <span style={{ flexShrink: 0, opacity: 0.7 }}>{icon}</span>
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: dim ? C.dim : C.text,
        fontSize: 11,
        fontWeight: 400,
      }}
    >
      {label}
    </span>
  </div>
);

const Divider: React.FC = () => (
  <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0 }} />
);

const ElementRow: React.FC<{ label: string; type: string; active?: boolean }> = ({
  label, type, active,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      height: 28,
      paddingLeft: 8,
      paddingRight: 8,
      borderRadius: 6,
      background: active ? C.surface2 : "transparent",
      border: `1px solid ${active ? C.border2 : "transparent"}`,
    }}
  >
    <div
      style={{
        width: 5,
        height: 5,
        borderRadius: 2,
        background: type === "plot" ? "#60A5FA" : C.accent,
        flexShrink: 0,
      }}
    />
    <span style={{ fontSize: 11, color: active ? C.text : C.muted, flex: 1 }}>{label}</span>
    <span
      style={{
        fontSize: 9,
        color: C.dim,
        background: C.surface2,
        padding: "1px 5px",
        borderRadius: 3,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {type}
    </span>
  </div>
);

const PropRow: React.FC<{ label: string; value: string; swatch?: boolean }> = ({
  label, value, swatch,
}) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <span style={{ fontSize: 11, color: C.dim }}>{label}</span>
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {swatch && (
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: value,
            border: `1px solid ${C.border2}`,
          }}
        />
      )}
      <span style={{ fontSize: 11, color: C.muted, fontFamily: "'Geist Mono', monospace" }}>
        {value}
      </span>
    </div>
  </div>
);

// Icon components
const GridIcon: React.FC<{ size?: number; color?: string }> = ({ size = 12, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ActivityIcon: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
  </svg>
);

const FilmIcon: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" /><line x1="17" y1="7" x2="22" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="17" x2="22" y2="17" />
  </svg>
);

const MonitorIcon: React.FC = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);
