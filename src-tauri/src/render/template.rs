use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub scene: SceneConfig,
    #[serde(default, deserialize_with = "null_seq_as_default")]
    pub elements: Vec<Element>,
}

/// `#[serde(default)]` covers a missing key but NOT an explicit `null`
/// (which errors with "invalid type: null, expected a sequence").
/// Templates are user-editable / community-sourced, so treat an explicit
/// `null` array the same as absent → empty.
fn null_seq_as_default<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneConfig {
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    pub font_size: Option<f32>,
    pub font: Option<String>,
    pub overlay_filename: Option<String>,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub decimal_rounding: Option<i32>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    /// Stable element ids in back-to-front draw order. Unknown/missing ids are
    /// ignored; elements absent from the list fall back to array order.
    pub layers: Option<Vec<String>>,
    /// Named groups of elements for list organisation and bulk repositioning.
    /// Render pipeline ignores this field entirely.
    #[serde(default)]
    pub groups: Vec<GroupConfig>,
    /// Named color variables. Elements reference them as `"$varname"` in any
    /// color field; a pre-pass resolves them before rendering.
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

/// A named collection of element IDs used for list organisation and bulk
/// drag in the editor. Has no effect on rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupConfig {
    pub id: String,
    pub name: String,
    pub element_ids: Vec<String>,
}

fn default_fps() -> u32 {
    30
}

/// A single overlay element. Internally tagged by `type`; every variant's
/// config carries a stable `id` used for z-order (elements array order) and
/// frontend selection. Adding a new graphic = one new variant + one
/// `OverlayElement` impl (see frame.rs) + one `scale` arm.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Element {
    Label(LabelConfig),
    Value(ValueConfig),
    Plot(PlotConfig),
    Meter(MeterConfig),
    Gauge(GaugeConfig),
    Rect(RectConfig),
    Image(ImageConfig),
}

impl Element {
    pub fn id(&self) -> &str {
        match self {
            Element::Label(c) => &c.id,
            Element::Value(c) => &c.id,
            Element::Plot(c) => &c.id,
            Element::Meter(c) => &c.id,
            Element::Gauge(c) => &c.id,
            Element::Rect(c) => &c.id,
            Element::Image(c) => &c.id,
        }
    }

    /// Scale every spatial field by `factor`. Each variant owns the knowledge
    /// of which of its fields are spatial — non-spatial fields (colors, fonts,
    /// opacity, units, decimal_rounding, fractional margins) are
    /// resolution-independent and left untouched.
    pub fn scale(&mut self, factor: f64) {
        let f32f = factor as f32;
        match self {
            Element::Label(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.font_size = c.font_size.map(|v| v * f32f);
                c.letter_spacing = c.letter_spacing.map(|v| v * f32f);
            }
            Element::Value(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.font_size = c.font_size.map(|v| v * f32f);
            }
            Element::Plot(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
                if let Some(line) = c.line.as_mut() {
                    line.width = line.width.map(|v| v * f32f);
                }
                if let Some(pl) = c.point_label.as_mut() {
                    pl.font_size = pl.font_size.map(|v| v * f32f);
                    pl.x_offset = pl.x_offset.map(|v| v * f32f);
                    pl.y_offset = pl.y_offset.map(|v| v * f32f);
                }
                if let Some(p) = c.point.as_mut() {
                    p.weight = p.weight.map(|v| v * f32f);
                    p.edge_width = p.edge_width.map(|v| v * f32f);
                }
                if let Some(points) = c.points.as_mut() {
                    for p in points {
                        p.weight = p.weight.map(|v| v * f32f);
                        p.edge_width = p.edge_width.map(|v| v * f32f);
                    }
                }
                if let Some(markers) = c.markers.as_mut() {
                    for marker in markers {
                        marker.width = marker.width.map(|v| v * f32f);
                        marker.height = marker.height.map(|v| v * f32f);
                    }
                }
            }
            Element::Meter(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
                c.radius = c.radius.map(|v| v * f32f);
                c.gap = c.gap.map(|v| v * f32f);
                c.border_width = c.border_width.map(|v| v * f32f);
                c.scale_font_size = c.scale_font_size.map(|v| v * f32f);
                c.scale_offset = c.scale_offset.map(|v| v * f32f);
                c.scale_tick_length = c.scale_tick_length.map(|v| v * f32f);
                c.scale_tick_width = c.scale_tick_width.map(|v| v * f32f);
            }
            Element::Gauge(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
                c.arc_width = c.arc_width.map(|v| v * f32f);
                c.needle_width = c.needle_width.map(|v| v * f32f);
                c.cap_radius = c.cap_radius.map(|v| v * f32f);
                c.background_margin = c.background_margin.map(|v| v * f32f);
            }
            Element::Rect(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
                c.radius = c.radius.map(|v| v * f32f);
                c.border_width = c.border_width.map(|v| v * f32f);
            }
            Element::Image(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelConfig {
    pub id: String,
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub font_size: Option<f32>,
    /// Additional tracking between characters in px. Default 0.
    pub letter_spacing: Option<f32>,
    pub font: Option<String>,
    pub italic: Option<bool>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub decimal_rounding: Option<i32>,
    /// Horizontal alignment relative to x. "left" (default) | "center" | "right".
    pub text_align: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueConfig {
    pub id: String,
    pub value: String,
    pub x: i32,
    pub y: i32,
    pub font_size: Option<f32>,
    pub font: Option<String>,
    pub italic: Option<bool>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub unit: Option<String>,
    pub suffix: Option<String>,
    pub decimal_rounding: Option<i32>,
    pub hours_offset: Option<f32>,
    pub time_format: Option<String>,
    /// For `value: "distance"` — which reference point to measure from/to.
    /// Options: "overlay_start" (default), "activity_start", "overlay_end", "activity_end",
    /// "until_custom" (distance until a custom point), "since_custom" (distance since a custom point).
    pub distance_reference: Option<String>,
    /// For `distance_reference: "until_custom"` or `"since_custom"` — the reference distance in the
    /// element's display unit (km, mi, or m per `unit`). Converted to metres at render time.
    pub distance_target: Option<f64>,
    /// Horizontal alignment relative to x. "left" (default) | "center" | "right".
    pub text_align: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotConfig {
    pub id: String,
    pub value: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub dpi: Option<f32>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub line: Option<LineConfig>,
    pub fill: Option<FillConfig>,
    pub margin: Option<f64>,
    /// Single position marker for the current-value dot (preferred schema).
    pub point: Option<PointConfig>,
    /// Legacy: a list of markers — only the first entry is used. Kept for
    /// backward-compat with user templates authored before the schema change;
    /// new saves always write `point` instead. See `effective_point()`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<PointConfig>>,
    pub markers: Option<Vec<CourseMarkerConfig>>,
    pub point_label: Option<PointLabelConfig>,
    pub rotation: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineConfig {
    pub width: Option<f32>,
    pub color: Option<String>,
    /// Opacity for the portion of the course line before the current position.
    pub past_opacity: Option<f32>,
    /// Opacity for the portion of the course line after the current position.
    pub future_opacity: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillConfig {
    pub opacity: Option<f32>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointConfig {
    pub color: Option<String>,
    pub weight: Option<f32>,
    pub opacity: Option<f32>,
    pub edge_color: Option<String>,
    /// Edge stroke width in px. Default 1.
    pub edge_width: Option<f32>,
    pub remove_edge_color: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CourseMarkerConfig {
    pub id: Option<String>,
    pub name: Option<String>,
    /// Marker position in metres from the activity start.
    pub distance: Option<f64>,
    /// Visual style: "checkered" (default), "circle", or "rectangle".
    pub style: Option<String>,
    /// Primary color for circle/rectangle markers. Default red.
    pub color: Option<String>,
    /// Long side of the marker in px. Default 34.
    pub width: Option<f32>,
    /// Short side of the marker in px. Default 10.
    pub height: Option<f32>,
    /// Additional clockwise rotation in degrees after the default perpendicular-to-course angle.
    pub rotation: Option<f32>,
    /// Master opacity (0-1). Default 1.
    pub opacity: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointLabelConfig {
    pub font_size: Option<f32>,
    pub color: Option<String>,
    pub font: Option<String>,
    pub italic: Option<bool>,
    pub x_offset: Option<f32>,
    pub y_offset: Option<f32>,
    pub units: Option<Vec<String>>,
    pub decimal_rounding: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RangeBound {
    Number(f64),
    Keyword(RangeKeyword),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RangeKeyword {
    Min,
    Max,
}

/// A bar that fills proportionally to the current value of a metric, mapped
/// linearly between `min` and `max` (both in the element's display `unit`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeterConfig {
    pub id: String,
    pub value: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub min: RangeBound,
    pub max: RangeBound,
    /// Fill growth direction: "up" (default), "down", "left", "right".
    pub direction: Option<String>,
    pub unit: Option<String>,
    /// Fill color (used when `gradient` is unset).
    pub color: Option<String>,
    /// Optional ordered color stops interpolated across the meter's value
    /// range (min→max). When set, each lit portion takes the gradient color
    /// sampled at its position; overrides `color`.
    pub gradient: Option<Vec<String>>,
    /// Optional track (empty portion) color; omitted = no track drawn.
    pub background: Option<String>,
    /// Opacity for the track only (0–1), fully independent of the fill.
    /// Unset = fully opaque (the track color's own alpha applies).
    pub background_opacity: Option<f32>,
    /// Opacity for the filled portion only (0–1). Primary fill-alpha control;
    /// falls back to `opacity` when unset. Independent of `background_opacity`.
    pub fill_opacity: Option<f32>,
    pub opacity: Option<f32>,
    /// Corner radius in px (rounded rect). Default 0 (sharp corners).
    pub radius: Option<f32>,
    /// When >= 1, render as that many discrete segments instead of one
    /// continuous fill. Segments light up proportionally to the value.
    pub segments: Option<u32>,
    /// Gap in px between segments (only used when `segments` is set).
    pub gap: Option<f32>,
    /// Clockwise rotation in degrees around the element center. Default 0.
    pub rotation: Option<f32>,
    /// When set, draws a border around the entire meter bounding box.
    pub border_color: Option<String>,
    /// Border stroke width in px. Default 2.
    pub border_width: Option<f32>,
    /// Border opacity (0–1). Falls back to `opacity` when unset.
    pub border_opacity: Option<f32>,
    /// When set, draws tick marks + value labels beside the meter.
    /// Empty vec → auto labels at min, mid, max. Non-empty → those exact values.
    pub scale_labels: Option<Vec<f64>>,
    /// Color for scale ticks and labels. Falls back to fill color.
    pub scale_color: Option<String>,
    /// Font size for scale labels in px. Default 20.
    pub scale_font_size: Option<f32>,
    /// Typeface for scale labels. Falls back to the scene font.
    pub scale_font: Option<String>,
    /// Gap between the bar edge and the label text in px. Default 8.
    pub scale_offset: Option<f32>,
    /// How far end ticks (min/max) extend beyond the bar edge in px. Default 6. Set 0 for flush.
    pub scale_tick_length: Option<f32>,
    /// Stroke width of tick lines in px. Default 1.
    pub scale_tick_width: Option<f32>,
    /// Optional suffix appended to every tick label (e.g. "mph").
    pub scale_suffix: Option<String>,
    /// Number of evenly-spaced unlabeled tick marks to draw across the full bar range.
    pub scale_ticks: Option<u32>,
}

/// A circular dial: an arc track plus a needle that points to the current
/// value, mapped linearly between `min` and `max` (in the display `unit`)
/// across an angular sweep. Angles are degrees, 0° = east, clockwise.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GaugeConfig {
    pub id: String,
    pub value: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub min: RangeBound,
    pub max: RangeBound,
    pub unit: Option<String>,
    /// Needle angle at `min`. Default 135° (lower-left).
    pub start_angle: Option<f32>,
    /// Total sweep from `min` to `max`, clockwise. Default 270°.
    pub sweep_angle: Option<f32>,
    /// Base color used for arc/needle when their specific colors are unset.
    pub color: Option<String>,
    pub arc_color: Option<String>,
    pub arc_width: Option<f32>,
    /// Optional filled arc from `start_angle` to the current value.
    pub progress_color: Option<String>,
    /// Gradient color stops for the progress arc (min→max). Overrides `progress_color` when set.
    pub gradient: Option<Vec<String>>,
    pub needle_color: Option<String>,
    pub needle_width: Option<f32>,
    /// Filled circle drawn at the tip of the progress arc. Omit for no cap.
    pub cap_color: Option<String>,
    /// Radius of the cap dot in pixels. Default = arc_width / 2.
    pub cap_radius: Option<f32>,
    /// Filled circle behind the whole gauge. Requires `background_opacity > 0`.
    pub background_color: Option<String>,
    pub background_opacity: Option<f32>,
    /// Extra radius beyond the gauge bounds for the background circle in px. Default 0.
    pub background_margin: Option<f32>,
    /// When true, the unfilled portion of the arc (current value → max) is not drawn.
    pub hide_track: Option<bool>,
    pub opacity: Option<f32>,
    /// Clockwise rotation in degrees around the element center. Default 0.
    pub rotation: Option<f32>,
}

/// A static rectangle. Supports solid fill, stroke border, rounded corners,
/// and rotation. Fill and border opacities are independently controllable:
/// `fill_opacity` × `opacity` gives effective fill alpha; `opacity` alone
/// gates the border — so setting `fill_opacity: 0` with `opacity: 1` draws
/// an outline-only rectangle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RectConfig {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Fill color. Default white.
    pub color: Option<String>,
    /// Master element opacity (0–1). Multiplies fill_opacity for the fill;
    /// applied directly to the border. Default 1.
    pub opacity: Option<f32>,
    /// Fill-specific opacity multiplier (0–1). Effective fill alpha =
    /// fill_opacity × opacity. Default 1 (fill fully visible).
    pub fill_opacity: Option<f32>,
    /// Border stroke color. When unset no border is drawn.
    pub border_color: Option<String>,
    /// Border stroke width in px. Default 2.
    pub border_width: Option<f32>,
    /// Border opacity (0–1). Falls back to `opacity` when unset.
    pub border_opacity: Option<f32>,
    /// Corner radius in px. Default 0 (sharp corners).
    pub radius: Option<f32>,
    /// Clockwise rotation in degrees around the element center. Default 0.
    pub rotation: Option<f32>,
}

/// A static image asset (PNG, WebP, or SVG) placed at an absolute position.
/// `file` is resolved against the assets search path at render time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageConfig {
    pub id: String,
    /// Asset filename (e.g. "bolt.svg") resolved via the assets search path,
    /// or an absolute filesystem path.
    pub file: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Master opacity (0–1). Default 1.
    pub opacity: Option<f32>,
    /// Clockwise rotation in degrees around the element center. Default 0.
    pub rotation: Option<f32>,
    /// Activity metric to read BPM from (e.g. "heartrate"). When set, the
    /// image pulses at the live metric value. Overridden by `pulse_bpm`.
    pub pulse_metric: Option<String>,
    /// Fixed BPM for the pulse animation. Takes priority over `pulse_metric`.
    pub pulse_bpm: Option<f64>,
    /// Peak scale added on each beat (e.g. 0.2 = 20% larger). Default 0.15.
    pub pulse_amplitude: Option<f32>,
}

impl PlotConfig {
    /// Returns the single tracking-point config, preferring `point` over the
    /// legacy `points[0]` so both old and new template schemas work.
    pub fn effective_point(&self) -> Option<&PointConfig> {
        self.point
            .as_ref()
            .or_else(|| self.points.as_ref()?.first())
    }

    pub fn has_position_markers(&self) -> bool {
        self.effective_point().is_some()
    }

    pub fn line_color(&self) -> String {
        self.line
            .as_ref()
            .and_then(|l| l.color.clone())
            .or_else(|| self.color.clone())
            .unwrap_or_else(|| "#ffffff".to_string())
    }

    pub fn line_width(&self) -> f32 {
        self.line.as_ref().and_then(|l| l.width).unwrap_or(1.75)
    }

    pub fn fill_opacity(&self) -> Option<f32> {
        self.fill.as_ref().and_then(|f| f.opacity)
    }

    pub fn fill_color(&self) -> String {
        self.fill
            .as_ref()
            .and_then(|f| f.color.clone())
            .or_else(|| self.color.clone())
            .unwrap_or_else(|| "#ffffff".to_string())
    }

    pub fn margin_fraction(&self) -> f64 {
        self.margin.unwrap_or(0.1)
    }

    pub fn line_past_opacity(&self) -> Option<f32> {
        self.line.as_ref().and_then(|l| l.past_opacity)
    }

    pub fn line_future_opacity(&self) -> Option<f32> {
        self.line.as_ref().and_then(|l| l.future_opacity)
    }
}

impl Template {
    #[cfg(test)]
    pub fn from_value(raw: serde_json::Value) -> Result<Self, serde_json::Error> {
        Self::from_value_scaled(raw, None)
    }

    /// Parse a template, optionally retargeting it to a chosen output
    /// resolution. Templates are authored at one resolution; we scale every
    /// spatial field by a single uniform factor derived from **height**
    /// (`target_height / authored_height`) and set the canvas to the exact
    /// target. Non-16:9 targets keep their aspect: the canvas is the target
    /// width/height and elements positioned past the new width simply fall
    /// off-screen (acceptable until aspect-specific template variants exist).
    pub fn from_value_scaled(
        mut raw: serde_json::Value,
        target: Option<(u32, u32)>,
    ) -> Result<Self, serde_json::Error> {
        // Apply scene defaults before deserializing.
        if let Some(scene) = raw.get_mut("scene") {
            if scene.get("fps").is_none() {
                scene["fps"] = serde_json::json!(30);
            }
            if scene.get("font").is_none() {
                scene["font"] = serde_json::json!("Arial.ttf");
            }
        }

        // Resolve scene-level color variables ($varname → hex) throughout the
        // element tree before any field is deserialized.
        let vars: HashMap<String, String> = raw["scene"]["vars"]
            .as_object()
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_owned())))
                    .collect()
            })
            .unwrap_or_default();
        if !vars.is_empty()
            && let Some(items) = raw.get_mut("elements").and_then(|v| v.as_array_mut())
        {
            for item in items.iter_mut() {
                resolve_vars(item, &vars);
            }
        }

        // Inherit scene-level defaults (font, color, opacity, …) into each
        // element that doesn't set them explicitly. Generic — copies any
        // absent scene key into the element object; element configs ignore
        // keys they don't declare.
        let scene_snapshot = raw["scene"].clone();
        if let Some(items) = raw.get_mut("elements").and_then(|v| v.as_array_mut()) {
            for item in items.iter_mut() {
                merge_scene_into_item(&scene_snapshot, item);
            }
        }

        let mut template: Template = serde_json::from_value(raw)?;

        if let Some((tw, th)) = target {
            let authored_h = template.scene.height;
            template.scene.width = tw;
            template.scene.height = th;
            if authored_h > 0 {
                // Always retarget (even when factor ≈ 1) so the canvas adopts
                // the chosen width/height; e.g. 3840×2160 → 2160×2160 has
                // factor 1 but still needs the new scene dimensions above.
                let factor = th as f64 / authored_h as f64;
                template.scene.font_size = template.scene.font_size.map(|s| s * factor as f32);
                for el in &mut template.elements {
                    el.scale(factor);
                }
            }
        }

        Ok(template)
    }

    /// Element indices in back-to-front draw order: explicit `scene.layers`
    /// ids first (deduped, unknown ids skipped), then any remaining elements
    /// in array order.
    pub fn layer_order(&self) -> Vec<usize> {
        let mut out = Vec::with_capacity(self.elements.len());
        let mut seen = vec![false; self.elements.len()];

        if let Some(layers) = &self.scene.layers {
            for id in layers {
                if let Some(idx) = self.elements.iter().position(|e| e.id() == id)
                    && !seen[idx]
                {
                    seen[idx] = true;
                    out.push(idx);
                }
            }
        }
        for (idx, slot) in seen.iter().enumerate() {
            if !slot {
                out.push(idx);
            }
        }
        out
    }
}

/// Recursively replace `"$varname"` strings with their resolved color values.
fn resolve_vars(value: &mut serde_json::Value, vars: &HashMap<String, String>) {
    match value {
        serde_json::Value::String(s) => {
            if let Some(name) = s.strip_prefix('$')
                && let Some(resolved) = vars.get(name)
            {
                *s = resolved.clone();
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values_mut() {
                resolve_vars(v, vars);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                resolve_vars(v, vars);
            }
        }
        _ => {}
    }
}

fn merge_scene_into_item(scene: &serde_json::Value, item: &mut serde_json::Value) {
    if let (Some(scene_obj), Some(item_obj)) = (scene.as_object(), item.as_object_mut()) {
        for (k, v) in scene_obj {
            item_obj.entry(k).or_insert_with(|| v.clone());
        }
    }
}
