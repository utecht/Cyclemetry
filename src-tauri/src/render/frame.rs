/// Per-frame Skia rendering — draws one video frame to a raw RGBA byte buffer.
use serde::Serialize;
use skia_safe::{
    Canvas, Color, Font, FontMgr, FontStyle, ISize, ImageInfo, Paint, RRect, Rect, Typeface,
};
use std::collections::HashMap;

use crate::render::activity::{Activity, ATTR_DISTANCE};
use crate::render::chart::ChartCache;
use crate::render::color::{hex_with_opacity, lerp_gradient};
use crate::render::template::{
    Element, GaugeConfig, LabelConfig, MeterConfig, PlotConfig, SceneConfig, Template, ValueConfig,
};
use crate::render::units;

/// Pixel-perfect bounding box for a single overlay element in overlay coordinates.
#[derive(Debug, Clone, Serialize)]
pub struct ElementBounds {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// Everything an element needs to measure or draw itself for a given frame.
/// Shared across all elements so a new graphic just reads what it needs.
pub struct ElementCtx<'a> {
    pub activity: &'a Activity,
    pub scene: &'a SceneConfig,
    pub typefaces: &'a HashMap<String, Typeface>,
    /// One ChartCache per plot element, keyed by element id.
    pub charts: &'a HashMap<String, ChartCache>,
    pub fonts_dir: &'a str,
}

/// One overlay graphic. Every element family implements this; rendering,
/// measuring, cropping, and font/cache prep all dispatch through it with
/// zero per-type branching at the call sites.
pub trait OverlayElement {
    /// Visual bounding box for this frame, or `None` if nothing is drawn.
    fn measure(&self, ctx: &ElementCtx, frame_idx: usize) -> Option<ElementBounds>;

    /// Draw onto the canvas for this frame.
    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, frame_idx: usize);

    /// `true` if the bounding box varies frame-to-frame (e.g. changing text
    /// width). Static elements are measured once for the crop computation.
    fn is_dynamic(&self) -> bool {
        false
    }

    /// Font filenames this element needs preloaded into the typeface cache.
    fn fonts(&self, _scene: &SceneConfig) -> Vec<String> {
        Vec::new()
    }

    /// Prebuilt per-element chart cache, if any (plots only).
    fn build_chart(&self, _activity: &Activity, _fonts_dir: &str) -> Option<ChartCache> {
        None
    }

    /// Extent used for crop union: `(x0, y0, x1, y1)`. Defaults to the
    /// measured box; plots override to circumscribe their rotation.
    fn crop_extent(&self, ctx: &ElementCtx, frame_idx: usize) -> Option<(f32, f32, f32, f32)> {
        self.measure(ctx, frame_idx)
            .map(|b| (b.x, b.y, b.x + b.w, b.y + b.h))
    }
}

impl Element {
    pub fn as_overlay(&self) -> &dyn OverlayElement {
        match self {
            Element::Label(c) => c,
            Element::Value(c) => c,
            Element::Plot(c) => c,
            Element::Meter(c) => c,
            Element::Gauge(c) => c,
        }
    }
}

// ─── Label ─────────────────────────────────────────────────────────────────

impl OverlayElement for LabelConfig {
    fn fonts(&self, scene: &SceneConfig) -> Vec<String> {
        vec![self
            .font
            .as_deref()
            .or(scene.font.as_deref())
            .unwrap_or("Arial.ttf")
            .to_string()]
    }

    fn measure(&self, ctx: &ElementCtx, _frame_idx: usize) -> Option<ElementBounds> {
        let font_name = self
            .font
            .as_deref()
            .or(ctx.scene.font.as_deref())
            .unwrap_or("Arial.ttf");
        let font_size = self.font_size.or(ctx.scene.font_size).unwrap_or(32.0);
        let font = load_font(font_name, font_size, ctx.fonts_dir)?;
        let (_, rect) = font.measure_str(&self.text, None);
        Some(ElementBounds {
            id: self.id.clone(),
            x: self.x + rect.left,
            y: self.y + rect.top,
            w: rect.width(),
            h: rect.height(),
        })
    }

    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, _frame_idx: usize) {
        let font_name = self
            .font
            .as_deref()
            .or(ctx.scene.font.as_deref())
            .unwrap_or("Arial.ttf");
        let font_size = self.font_size.or(ctx.scene.font_size).unwrap_or(32.0);
        let color_str = self.color.as_deref().unwrap_or("#ffffff");
        let (r, g, b, a) = hex_with_opacity(color_str, self.opacity);
        let color = Color::from_argb(a, r, g, b);

        let font = ctx
            .typefaces
            .get(font_name)
            .map(|tf| Font::new(tf.clone(), font_size))
            .or_else(|| load_font(font_name, font_size, ctx.fonts_dir));
        if let Some(font) = font {
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(color);
            canvas.draw_str(&self.text, (self.x, self.y), &font, &paint);
        }
    }
}

// ─── Value ─────────────────────────────────────────────────────────────────

impl ValueConfig {
    fn sample(&self, activity: &Activity, frame_idx: usize) -> f64 {
        if !activity.valid_attributes.contains(&self.value) {
            return 0.0;
        }
        if self.value == ATTR_DISTANCE {
            let target_m = self
                .distance_target
                .map(|t| units::distance_target_to_m(t, self.unit.as_deref()));
            activity.get_distance(self.distance_reference.as_deref(), target_m, frame_idx)
        } else {
            activity.get_scalar(&self.value, frame_idx)
        }
    }
}

impl OverlayElement for ValueConfig {
    fn is_dynamic(&self) -> bool {
        true
    }

    fn fonts(&self, scene: &SceneConfig) -> Vec<String> {
        vec![self
            .font
            .as_deref()
            .or(scene.font.as_deref())
            .unwrap_or("Arial.ttf")
            .to_string()]
    }

    fn measure(&self, ctx: &ElementCtx, frame_idx: usize) -> Option<ElementBounds> {
        let raw = self.sample(ctx.activity, frame_idx);
        let text = format_value(raw, self);
        let font_name = self
            .font
            .as_deref()
            .or(ctx.scene.font.as_deref())
            .unwrap_or("Arial.ttf");
        let font_size = self.font_size.or(ctx.scene.font_size).unwrap_or(32.0);
        let font = load_font(font_name, font_size, ctx.fonts_dir)?;
        let (_, rect) = font.measure_str(&text, None);
        Some(ElementBounds {
            id: self.id.clone(),
            x: self.x + rect.left,
            y: self.y + rect.top,
            w: rect.width(),
            h: rect.height(),
        })
    }

    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, frame_idx: usize) {
        if !ctx.activity.valid_attributes.contains(&self.value) {
            return;
        }
        let raw = self.sample(ctx.activity, frame_idx);
        let display = format_value(raw, self);

        let font_name = self
            .font
            .as_deref()
            .or(ctx.scene.font.as_deref())
            .unwrap_or("Arial.ttf");
        let font_size = self.font_size.or(ctx.scene.font_size).unwrap_or(32.0);
        let color_str = self.color.as_deref().unwrap_or("#ffffff");
        let (r, g, b, a) = hex_with_opacity(color_str, self.opacity);
        let color = Color::from_argb(a, r, g, b);

        if let Some(tf) = ctx.typefaces.get(font_name) {
            let font = Font::new(tf.clone(), font_size);
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(color);
            canvas.draw_str(&display, (self.x, self.y), &font, &paint);
        }
    }
}

// ─── Plot ──────────────────────────────────────────────────────────────────

impl OverlayElement for PlotConfig {
    fn build_chart(&self, activity: &Activity, fonts_dir: &str) -> Option<ChartCache> {
        let (x_data, y_data) = activity.plot_data(&self.value);
        ChartCache::build(self, x_data, y_data, fonts_dir)
    }

    fn measure(&self, _ctx: &ElementCtx, _frame_idx: usize) -> Option<ElementBounds> {
        Some(ElementBounds {
            id: self.id.clone(),
            x: self.x as f32,
            y: self.y as f32,
            w: self.width as f32,
            h: self.height as f32,
        })
    }

    fn crop_extent(&self, _ctx: &ElementCtx, _frame_idx: usize) -> Option<(f32, f32, f32, f32)> {
        // Rotated plots are bounded by their circumscribed circle.
        let rot = self.rotation.unwrap_or(0.0);
        if rot != 0.0 {
            let cx = self.x as f32 + self.width as f32 / 2.0;
            let cy = self.y as f32 + self.height as f32 / 2.0;
            let r = ((self.width as f32).powi(2) + (self.height as f32).powi(2)).sqrt() / 2.0;
            Some((cx - r, cy - r, cx + r, cy + r))
        } else {
            Some((
                self.x as f32,
                self.y as f32,
                self.x as f32 + self.width as f32,
                self.y as f32 + self.height as f32,
            ))
        }
    }

    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, frame_idx: usize) {
        let Some(chart) = ctx.charts.get(&self.id) else {
            return;
        };
        let rotation = self.rotation.unwrap_or(0.0);
        if rotation != 0.0 {
            let cx = self.x as f32 + self.width as f32 / 2.0;
            let cy = self.y as f32 + self.height as f32 / 2.0;
            canvas.save();
            canvas.rotate(rotation, Some(skia_safe::Point::new(cx, cy)));
        }
        if self.has_position_markers() {
            chart.draw_on_canvas(canvas, frame_idx);
        } else {
            canvas.draw_image(
                &chart.background,
                skia_safe::Point::new(chart.x_offset as f32, chart.y_offset as f32),
                None,
            );
        }
        if rotation != 0.0 {
            canvas.restore();
        }
    }
}

// ─── Meter ─────────────────────────────────────────────────────────────────

impl MeterConfig {
    /// Current fill fraction in [0, 1] for this frame.
    fn fraction(&self, activity: &Activity, frame_idx: usize) -> f32 {
        if !activity.valid_attributes.contains(&self.value) {
            return 0.0;
        }
        let raw = activity.get_scalar(&self.value, frame_idx);
        let (conv, _) = units::resolve(&self.value, self.unit.as_deref());
        let v = conv.apply(raw);
        let span = self.max - self.min;
        if span.abs() < f64::EPSILON {
            return 0.0;
        }
        (((v - self.min) / span) as f32).clamp(0.0, 1.0)
    }

    fn rect(&self) -> Rect {
        Rect::from_xywh(
            self.x as f32,
            self.y as f32,
            self.width as f32,
            self.height as f32,
        )
    }

    /// Sub-rect of the track that is filled, given the direction.
    fn fill_rect(&self, frac: f32) -> Rect {
        let (x, y, w, h) = (
            self.x as f32,
            self.y as f32,
            self.width as f32,
            self.height as f32,
        );
        match self.direction.as_deref().unwrap_or("up") {
            "down" => Rect::from_xywh(x, y, w, h * frac),
            "left" => Rect::from_xywh(x + w * (1.0 - frac), y, w * frac, h),
            "right" => Rect::from_xywh(x, y, w * frac, h),
            // "up" (default): grow from the bottom edge upward.
            _ => Rect::from_xywh(x, y + h * (1.0 - frac), w, h * frac),
        }
    }

    /// Rect for segment `i` of `n`, where segment 0 is anchored at the
    /// meter's `min` end (bottom for "up", top for "down", left for
    /// "right", right for "left").
    fn segment_rect(&self, i: u32, n: u32, gap: f32) -> Rect {
        let (x0, y0, w, h) = (
            self.x as f32,
            self.y as f32,
            self.width as f32,
            self.height as f32,
        );
        let dir = self.direction.as_deref().unwrap_or("up");
        let vertical = matches!(dir, "up" | "down");
        let axis = if vertical { h } else { w };
        let seg = ((axis - gap * (n as f32 - 1.0)) / n as f32).max(0.0);
        let offset = i as f32 * (seg + gap);
        match dir {
            "down" => Rect::from_xywh(x0, y0 + offset, w, seg),
            "right" => Rect::from_xywh(x0 + offset, y0, seg, h),
            "left" => Rect::from_xywh(x0 + w - offset - seg, y0, seg, h),
            _ => Rect::from_xywh(x0, y0 + h - offset - seg, w, seg),
        }
    }

    fn draw_segmented(&self, canvas: &Canvas, paint: &mut Paint, n: u32, frac: f32, radius: f32) {
        let gap = self.gap.unwrap_or(0.0).max(0.0);
        let lit = (frac * n as f32).round() as u32;
        let grad = self.gradient.as_ref().filter(|g| !g.is_empty());
        for i in 0..n {
            let color = if i < lit {
                let (r, g, b, a) = match grad {
                    Some(stops) => {
                        let t = (i as f32 + 0.5) / n as f32;
                        lerp_gradient(stops, t, self.opacity)
                    }
                    None => {
                        hex_with_opacity(self.color.as_deref().unwrap_or("#ffffff"), self.opacity)
                    }
                };
                Some(Color::from_argb(a, r, g, b))
            } else {
                self.background.as_deref().map(|bg| {
                    let (r, g, b, a) = hex_with_opacity(bg, self.opacity);
                    Color::from_argb(a, r, g, b)
                })
            };
            if let Some(c) = color {
                paint.set_color(c);
                let rect = self.segment_rect(i, n, gap);
                if radius > 0.0 {
                    canvas.draw_rrect(RRect::new_rect_xy(rect, radius, radius), paint);
                } else {
                    canvas.draw_rect(rect, paint);
                }
            }
        }
    }
}

impl OverlayElement for MeterConfig {
    fn measure(&self, _ctx: &ElementCtx, _frame_idx: usize) -> Option<ElementBounds> {
        Some(ElementBounds {
            id: self.id.clone(),
            x: self.x as f32,
            y: self.y as f32,
            w: self.width as f32,
            h: self.height as f32,
        })
    }

    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, frame_idx: usize) {
        let rotation = self.rotation.unwrap_or(0.0);
        if rotation != 0.0 {
            let cx = self.x as f32 + self.width as f32 / 2.0;
            let cy = self.y as f32 + self.height as f32 / 2.0;
            canvas.save();
            canvas.rotate(rotation, Some(skia_safe::Point::new(cx, cy)));
        }

        let radius = self.radius.unwrap_or(0.0);
        let mut paint = Paint::default();
        paint.set_anti_alias(true);

        if let Some(n) = self.segments.filter(|n| *n >= 1) {
            let frac = self.fraction(ctx.activity, frame_idx);
            self.draw_segmented(canvas, &mut paint, n, frac, radius);
            if rotation != 0.0 {
                canvas.restore();
            }
            return;
        }

        // Track (empty portion), if a background color is set.
        if let Some(bg) = self.background.as_deref() {
            let (r, g, b, a) = hex_with_opacity(bg, self.opacity);
            paint.set_color(Color::from_argb(a, r, g, b));
            if radius > 0.0 {
                canvas.draw_rrect(RRect::new_rect_xy(self.rect(), radius, radius), &paint);
            } else {
                canvas.draw_rect(self.rect(), &paint);
            }
        }

        // Fill.
        let frac = self.fraction(ctx.activity, frame_idx);
        if frac > 0.0 {
            let color_str = self.color.as_deref().unwrap_or("#ffffff");
            let (r, g, b, a) = hex_with_opacity(color_str, self.opacity);
            paint.set_color(Color::from_argb(a, r, g, b));
            let fr = self.fill_rect(frac);
            if radius > 0.0 {
                canvas.draw_rrect(RRect::new_rect_xy(fr, radius, radius), &paint);
            } else {
                canvas.draw_rect(fr, &paint);
            }
        }

        if rotation != 0.0 {
            canvas.restore();
        }
    }
}

// ─── Gauge ─────────────────────────────────────────────────────────────────

impl GaugeConfig {
    fn fraction(&self, activity: &Activity, frame_idx: usize) -> f32 {
        if !activity.valid_attributes.contains(&self.value) {
            return 0.0;
        }
        let raw = activity.get_scalar(&self.value, frame_idx);
        let (conv, _) = units::resolve(&self.value, self.unit.as_deref());
        let v = conv.apply(raw);
        let span = self.max - self.min;
        if span.abs() < f64::EPSILON {
            return 0.0;
        }
        (((v - self.min) / span) as f32).clamp(0.0, 1.0)
    }

    fn argb(&self, specific: Option<&str>, opacity: Option<f32>) -> Color {
        let s = specific.or(self.color.as_deref()).unwrap_or("#ffffff");
        let (r, g, b, a) = hex_with_opacity(s, opacity);
        Color::from_argb(a, r, g, b)
    }
}

impl OverlayElement for GaugeConfig {
    fn measure(&self, _ctx: &ElementCtx, _frame_idx: usize) -> Option<ElementBounds> {
        Some(ElementBounds {
            id: self.id.clone(),
            x: self.x as f32,
            y: self.y as f32,
            w: self.width as f32,
            h: self.height as f32,
        })
    }

    fn draw(&self, canvas: &Canvas, ctx: &ElementCtx, frame_idx: usize) {
        let cx = self.x as f32 + self.width as f32 / 2.0;
        let cy = self.y as f32 + self.height as f32 / 2.0;

        let rotation = self.rotation.unwrap_or(0.0);
        if rotation != 0.0 {
            canvas.save();
            canvas.rotate(rotation, Some(skia_safe::Point::new(cx, cy)));
        }

        let arc_w = self.arc_width.unwrap_or(8.0);
        let needle_w = self.needle_width.unwrap_or(4.0);
        // Keep the stroked arc fully inside the bounding box.
        let r = (self.width.min(self.height) as f32) / 2.0 - arc_w / 2.0;
        if r <= 0.0 {
            if rotation != 0.0 {
                canvas.restore();
            }
            return;
        }
        let start = self.start_angle.unwrap_or(135.0);
        let sweep = self.sweep_angle.unwrap_or(270.0);
        let frac = self.fraction(ctx.activity, frame_idx);

        let oval = Rect::from_ltrb(cx - r, cy - r, cx + r, cy + r);

        let mut arc_paint = Paint::default();
        arc_paint.set_anti_alias(true);
        arc_paint.set_style(skia_safe::paint::Style::Stroke);
        arc_paint.set_stroke_cap(skia_safe::paint::Cap::Round);

        // Track arc.
        arc_paint.set_stroke_width(arc_w);
        arc_paint.set_color(self.argb(self.arc_color.as_deref(), self.opacity));
        canvas.draw_arc(oval, start, sweep, false, &arc_paint);

        // Progress arc (start → current), if a color is set.
        if let Some(pc) = self.progress_color.as_deref() {
            arc_paint.set_color(self.argb(Some(pc), self.opacity));
            canvas.draw_arc(oval, start, sweep * frac, false, &arc_paint);
        }

        // Needle.
        let theta = (start + sweep * frac).to_radians();
        let nx = cx + theta.cos() * r;
        let ny = cy + theta.sin() * r;
        let mut needle = Paint::default();
        needle.set_anti_alias(true);
        needle.set_style(skia_safe::paint::Style::Stroke);
        needle.set_stroke_cap(skia_safe::paint::Cap::Round);
        needle.set_stroke_width(needle_w);
        needle.set_color(self.argb(self.needle_color.as_deref(), self.opacity));
        canvas.draw_line((cx, cy), (nx, ny), &needle);

        // Hub.
        needle.set_style(skia_safe::paint::Style::Fill);
        canvas.draw_circle((cx, cy), needle_w * 1.5, &needle);

        if rotation != 0.0 {
            canvas.restore();
        }
    }
}

// ─── Measurement ───────────────────────────────────────────────────────────

/// Measure every element in the template for the given frame, returning
/// pixel-perfect bounding boxes using the same Skia font metrics used to render.
pub fn measure_elements(
    frame_idx: usize,
    activity: &Activity,
    template: &Template,
    fonts_dir: &str,
) -> Vec<ElementBounds> {
    let charts: HashMap<String, ChartCache> = HashMap::new();
    let typefaces: HashMap<String, Typeface> = HashMap::new();
    let ctx = ElementCtx {
        activity,
        scene: &template.scene,
        typefaces: &typefaces,
        charts: &charts,
        fonts_dir,
    };
    template
        .elements
        .iter()
        .filter_map(|e| e.as_overlay().measure(&ctx, frame_idx))
        .collect()
}

/// All pre-computed data that stays constant across frames.
pub struct SceneCache {
    /// Pre-rendered base frame as an immutable Skia Image.
    /// Stored as Image (not raw bytes) to avoid a heap allocation + 8 MB copy on every frame.
    pub base_image: skia_safe::Image,
    /// One ChartCache per plot element, keyed by element id.
    pub charts: HashMap<String, ChartCache>,
    pub width: u32,
    pub height: u32,
    /// Pre-loaded typefaces keyed by filename. Eliminates disk I/O inside the per-frame
    /// hot path — Font::new(typeface.clone(), size) is trivially cheap.
    pub typefaces: HashMap<String, Typeface>,
}

impl SceneCache {
    pub fn build(
        activity: &Activity,
        template: &Template,
        fonts_dir: &str,
    ) -> Result<Self, String> {
        let w = template.scene.width;
        let h = template.scene.height;

        // --- Pre-load all typefaces referenced by elements ---
        let mut typefaces: HashMap<String, Typeface> = HashMap::new();
        for font_name in template
            .elements
            .iter()
            .flat_map(|e| e.as_overlay().fonts(&template.scene))
        {
            if let std::collections::hash_map::Entry::Vacant(e) = typefaces.entry(font_name.clone())
            {
                if let Some(tf) = load_typeface(&font_name, fonts_dir) {
                    e.insert(tf);
                } else {
                    eprintln!("Warning: could not load font '{font_name}'; text elements using it will not render");
                }
            }
        }

        // --- Build chart caches (keyed by element id) ---
        let mut charts: HashMap<String, ChartCache> = HashMap::new();
        for el in &template.elements {
            if let Some(cache) = el.as_overlay().build_chart(activity, fonts_dir) {
                charts.insert(el.id().to_string(), cache);
            }
        }

        // --- Pre-render transparent base frame as a Skia Image ---
        let base_image = render_base_frame(w, h)?;

        Ok(SceneCache {
            base_image,
            charts,
            width: w,
            height: h,
            typefaces,
        })
    }
}

/// Rectangular sub-region of the full overlay frame, in overlay pixel coords.
/// When a render is cropped to the union of all visible elements, only this
/// window is rasterised + piped + encoded — the rest is fully transparent and
/// pure overhead. `x`/`y` is the placement offset the compositor needs.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct CropRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Render a single video frame and return raw BGRA bytes.
///
/// `crop`: when `Some`, the surface is sized to the crop window and the canvas
/// is translated so all absolute-coordinate draws (base image, charts, text)
/// land correctly while only the window is captured. `None` = full frame
/// (preview path).
pub fn render_frame(
    frame_idx: usize,
    cache: &SceneCache,
    activity: &Activity,
    template: &Template,
    crop: Option<&CropRect>,
) -> Vec<u8> {
    let (w, h, ox, oy) = match crop {
        Some(c) => (c.w as i32, c.h as i32, c.x, c.y),
        None => (cache.width as i32, cache.height as i32, 0, 0),
    };

    let info = ImageInfo::new(
        ISize::new(w, h),
        skia_safe::ColorType::BGRA8888,
        skia_safe::AlphaType::Premul,
        None,
    );
    let row_bytes = (w * 4) as usize;

    // Composite straight into the output buffer: wrap a raster surface around
    // `pixels` so Skia draws in place. This drops both the surface's separate
    // backing-store allocation and the full-frame read_pixels copy the old
    // raster()+read_pixels path paid every frame. Render is fully hidden behind
    // encode, so this is a memory-traffic / allocator-churn win, not a speedup.
    // A fresh vec is zeroed = transparent BGRA; the base image covers the whole
    // crop window, so no explicit clear is needed.
    let mut pixels = vec![0u8; (h as usize) * row_bytes];
    {
        let mut surface =
            skia_safe::surfaces::wrap_pixels(&info, &mut pixels, Some(row_bytes), None)
                .expect("Skia surface");
        let canvas = surface.canvas();

        // Shift the world so the crop window maps to (0,0); all draw calls
        // below keep using absolute overlay coordinates unchanged.
        if ox != 0 || oy != 0 {
            canvas.translate((-ox as f32, -oy as f32));
        }

        // 1. Blit transparent base frame.
        //    Drawing an Image reference — no extra allocation or byte copy.
        canvas.draw_image(&cache.base_image, (0, 0), None);

        // 2. Draw all elements back-to-front according to scene.layers.
        let ctx = ElementCtx {
            activity,
            scene: &template.scene,
            typefaces: &cache.typefaces,
            charts: &cache.charts,
            fonts_dir: "",
        };
        for idx in template.layer_order() {
            if let Some(el) = template.elements.get(idx) {
                el.as_overlay().draw(canvas, &ctx, frame_idx);
            }
        }
    } // surface dropped here → releases the &mut pixels borrow

    pixels
}

/// Union bounding box of every element that is ever drawn, across all frames.
///
/// Static elements (plots/labels) are measured once; dynamic elements (value
/// text changes width frame-to-frame) are measured at every frame (cheap: one
/// cached `Font` per config via load_font). The box is padded, clamped to the
/// frame, and rounded to even dimensions. Returns `None` when the box covers
/// ≥95% of the frame (cropping wouldn't pay off) or there is nothing to draw —
/// callers fall back to the full-frame path.
pub fn compute_crop_rect(
    activity: &Activity,
    template: &Template,
    fonts_dir: &str,
) -> Option<CropRect> {
    let fw = template.scene.width as f32;
    let fh = template.scene.height as f32;

    let (mut min_x, mut min_y) = (f32::INFINITY, f32::INFINITY);
    let (mut max_x, mut max_y) = (f32::NEG_INFINITY, f32::NEG_INFINITY);
    let mut acc = |x0: f32, y0: f32, x1: f32, y1: f32| {
        min_x = min_x.min(x0);
        min_y = min_y.min(y0);
        max_x = max_x.max(x1);
        max_y = max_y.max(y1);
    };

    let charts: HashMap<String, ChartCache> = HashMap::new();
    let typefaces: HashMap<String, Typeface> = HashMap::new();
    let ctx = ElementCtx {
        activity,
        scene: &template.scene,
        typefaces: &typefaces,
        charts: &charts,
        fonts_dir,
    };

    let n = activity.data_len();
    for el in &template.elements {
        let ov = el.as_overlay();
        if ov.is_dynamic() {
            for i in 0..n {
                if let Some((x0, y0, x1, y1)) = ov.crop_extent(&ctx, i) {
                    acc(x0, y0, x1, y1);
                }
            }
        } else if let Some((x0, y0, x1, y1)) = ov.crop_extent(&ctx, 0) {
            acc(x0, y0, x1, y1);
        }
    }

    if !min_x.is_finite() || !max_x.is_finite() || max_x <= min_x || max_y <= min_y {
        return None;
    }

    // Pad, clamp to frame, round origin down / extent up to even dimensions.
    const PAD: f32 = 16.0;
    let x0 = (min_x - PAD).floor().max(0.0);
    let y0 = (min_y - PAD).floor().max(0.0);
    let x1 = (max_x + PAD).ceil().min(fw);
    let y1 = (max_y + PAD).ceil().min(fh);

    let x = x0 as i32 & !1;
    let y = y0 as i32 & !1;
    let w = (((x1 as i32) - x).max(2) as u32 + 1) & !1;
    let h = (((y1 as i32) - y).max(2) as u32 + 1) & !1;
    let w = w.min(template.scene.width - x as u32);
    let h = h.min(template.scene.height - y as u32);

    // Not worth the contract change if the box is essentially the whole frame.
    if (w as f32 * h as f32) >= 0.95 * fw * fh {
        return None;
    }

    Some(CropRect { x, y, w, h })
}

// ─── Base frame pre-renderer ───────────────────────────────────────────────

fn render_base_frame(w: u32, h: u32) -> Result<skia_safe::Image, String> {
    let info = ImageInfo::new(
        ISize::new(w as i32, h as i32),
        skia_safe::ColorType::BGRA8888,
        skia_safe::AlphaType::Premul,
        None,
    );
    let mut surface = skia_safe::surfaces::raster(&info, None, None)
        .ok_or("Failed to create base frame surface")?;
    let canvas = surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    Ok(surface.image_snapshot())
}

// ─── Font loading ──────────────────────────────────────────────────────────

pub(crate) fn load_typeface(font_name: &str, fonts_dir: &str) -> Option<Typeface> {
    let mgr = FontMgr::default();
    // Bundled fonts first, then user-installed custom fonts.
    let candidates = [
        std::path::PathBuf::from(format!("{fonts_dir}/{font_name}")),
        crate::fonts_user_dir().join(font_name),
    ];
    for path in candidates {
        if let Ok(bytes) = std::fs::read(&path) {
            let data = skia_safe::Data::new_copy(&bytes);
            if let Some(tf) = mgr.new_from_data(&data, None) {
                return Some(tf);
            }
        }
    }
    // System font fallback: try the font name as a family, then common Linux
    // families (Arial is not typically installed on Linux).
    let primary = font_name
        .trim_end_matches(".ttf")
        .trim_end_matches(".TTF")
        .trim_end_matches(".otf")
        .trim_end_matches(".OTF");
    let fallbacks: &[&str] = if cfg!(target_os = "linux") {
        &[
            primary,
            "DejaVu Sans",
            "Liberation Sans",
            "Noto Sans",
            "Ubuntu",
            "FreeSans",
            "sans-serif",
        ]
    } else {
        &[primary]
    };
    for family in fallbacks {
        if let Some(tf) = mgr.match_family_style(family, FontStyle::normal()) {
            return Some(tf);
        }
    }
    None
}

fn load_font(font_name: &str, size: f32, fonts_dir: &str) -> Option<Font> {
    load_typeface(font_name, fonts_dir).map(|tf| Font::new(tf, size))
}

// ─── Value formatting ──────────────────────────────────────────────────────

fn format_value(raw: f64, cfg: &ValueConfig) -> String {
    // Convert from the GPX-native unit. Value elements do not auto-append a
    // unit suffix; the optional manual `suffix` field is applied below.
    let (conv, _) = units::resolve(&cfg.value, cfg.unit.as_deref());
    let v = conv.apply(raw);

    // Decimal rounding
    let text = match cfg.decimal_rounding {
        Some(0) => format!("{}", v.round() as i64),
        Some(n) if n > 0 => format!("{:.prec$}", v, prec = n as usize),
        _ => format!("{}", v.round() as i64),
    };

    // Suffix
    match &cfg.suffix {
        Some(s) => format!("{text}{s}"),
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use crate::render::template::Template;

    /// Unified model: explicit `scene.layers` ids drive draw order; elements
    /// not listed fall back to array order after the listed ones.
    #[test]
    fn layer_order_honors_explicit_ids_then_array_order() {
        let raw = serde_json::json!({
            "scene": { "width": 100, "height": 100, "layers": ["plot-0", "label-0"] },
            "elements": [
                { "type": "label", "id": "label-0", "text": "A", "x": 0.0, "y": 0.0 },
                { "type": "value", "id": "value-0", "value": "speed", "x": 0.0, "y": 0.0 },
                { "type": "plot", "id": "plot-0", "value": "elevation",
                  "x": 0, "y": 0, "width": 10, "height": 10 }
            ]
        });
        let t = Template::from_value(raw).unwrap();
        // plot-0 (idx 2), label-0 (idx 0) listed first; value-0 (idx 1) trails.
        assert_eq!(t.layer_order(), vec![2, 0, 1]);
    }
}
