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
    pub start: Option<usize>,
    pub end: Option<usize>,
    pub decimal_rounding: Option<i32>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    /// Stable element ids in back-to-front draw order. Unknown/missing ids are
    /// ignored; elements absent from the list fall back to array order.
    pub layers: Option<Vec<String>>,
}

fn default_fps() -> u32 {
    30
}

/// A single overlay element. Internally tagged by `type`; every variant's
/// config carries a stable `id` used for z-order (`scene.layers`) and the
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
}

impl Element {
    pub fn id(&self) -> &str {
        match self {
            Element::Label(c) => &c.id,
            Element::Value(c) => &c.id,
            Element::Plot(c) => &c.id,
            Element::Meter(c) => &c.id,
            Element::Gauge(c) => &c.id,
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
                c.x *= f32f;
                c.y *= f32f;
                c.font_size = c.font_size.map(|v| v * f32f);
            }
            Element::Value(c) => {
                c.x *= f32f;
                c.y *= f32f;
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
                if let Some(points) = c.points.as_mut() {
                    for p in points {
                        p.weight = p.weight.map(|v| v * f32f);
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
            }
            Element::Gauge(c) => {
                c.x = (c.x as f64 * factor).round() as i32;
                c.y = (c.y as f64 * factor).round() as i32;
                c.width = (c.width as f64 * factor).round() as u32;
                c.height = (c.height as f64 * factor).round() as u32;
                c.arc_width = c.arc_width.map(|v| v * f32f);
                c.needle_width = c.needle_width.map(|v| v * f32f);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelConfig {
    pub id: String,
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub font_size: Option<f32>,
    pub font: Option<String>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub decimal_rounding: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueConfig {
    pub id: String,
    pub value: String,
    pub x: f32,
    pub y: f32,
    pub font_size: Option<f32>,
    pub font: Option<String>,
    pub color: Option<String>,
    pub opacity: Option<f32>,
    pub unit: Option<String>,
    pub suffix: Option<String>,
    pub decimal_rounding: Option<i32>,
    pub hours_offset: Option<f32>,
    pub time_format: Option<String>,
    /// For `value: "distance"` — which reference point to measure from/to.
    /// Options: "overlay_start" (default), "activity_start", "overlay_end", "activity_end", "custom".
    pub distance_reference: Option<String>,
    /// For `distance_reference: "custom"` — the finish-line distance in the element's display
    /// unit (km, mi, or m per `unit`). Converted to metres at render time.
    pub distance_target: Option<f64>,
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
    pub points: Option<Vec<PointConfig>>,
    pub point_label: Option<PointLabelConfig>,
    pub rotation: Option<f32>,
    pub bbox: Option<serde_json::Value>,
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
    pub remove_edge_color: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointLabelConfig {
    pub font_size: Option<f32>,
    pub color: Option<String>,
    pub font: Option<String>,
    pub x_offset: Option<f32>,
    pub y_offset: Option<f32>,
    pub units: Option<Vec<String>>,
    pub decimal_rounding: Option<i32>,
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
    pub min: f64,
    pub max: f64,
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
    pub min: f64,
    pub max: f64,
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
    pub needle_color: Option<String>,
    pub needle_width: Option<f32>,
    pub opacity: Option<f32>,
    /// Clockwise rotation in degrees around the element center. Default 0.
    pub rotation: Option<f32>,
}

impl PlotConfig {
    pub fn has_position_markers(&self) -> bool {
        self.points.as_ref().map(|p| !p.is_empty()).unwrap_or(false)
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
                if let Some(idx) = self.elements.iter().position(|e| e.id() == id) {
                    if !seen[idx] {
                        seen[idx] = true;
                        out.push(idx);
                    }
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

fn merge_scene_into_item(scene: &serde_json::Value, item: &mut serde_json::Value) {
    if let (Some(scene_obj), Some(item_obj)) = (scene.as_object(), item.as_object_mut()) {
        for (k, v) in scene_obj {
            item_obj.entry(k).or_insert_with(|| v.clone());
        }
    }
}
