/// Chart rendering with Skia — the core performance optimization.
///
/// Pre-renders an entire chart to a cached Image once at scene init.
/// Per-frame cost is then: one image blit + one circle draw.
/// This replaces matplotlib's plt.savefig() which was 50–200ms per frame.
use skia_safe::{
    Canvas, Color, ISize, ImageInfo, Paint, PaintStyle, PathBuilder, Point, Rect, Typeface,
};

use crate::render::color::to_skia_color;
use crate::render::template::{CourseMarkerConfig, PlotConfig, PointLabelConfig};
use crate::render::units;

/// Pixel bounds of the data area inside a chart surface (excluding margins).
#[derive(Debug, Clone)]
pub struct PlotBounds {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

impl PlotBounds {
    pub fn width(&self) -> f32 {
        self.right - self.left
    }
    pub fn height(&self) -> f32 {
        self.bottom - self.top
    }
}

/// Geographic coordinate mapping for course/GPS plots.
/// Pre-computes the cos(lat) correction and a uniform scale with letterbox offsets
/// so the rendered track preserves real geographic proportions.
#[derive(Debug, Clone)]
pub struct GeoMapping {
    pub x_min: f64,
    pub y_min: f64,
    pub cos_lat: f64,
    pub scale: f32,
    /// Letterbox offsets (pixels) so the track is centered within the plot area.
    pub x_off: f32,
    pub y_off: f32,
}

impl GeoMapping {
    fn build(x_min: f64, x_max: f64, y_min: f64, y_max: f64, plot: &PlotBounds) -> Option<Self> {
        let lon_extent = x_max - x_min;
        let lat_extent = y_max - y_min;
        if lon_extent <= 0.0 || lat_extent <= 0.0 {
            return None;
        }
        let mean_lat = (y_min + y_max) / 2.0;
        let cos_lat = mean_lat.to_radians().cos();
        let lon_px = lon_extent * cos_lat;
        let scale = (plot.width() as f64 / lon_px).min(plot.height() as f64 / lat_extent) as f32;
        let x_off = (plot.width() - lon_px as f32 * scale) / 2.0;
        let y_off = (plot.height() - lat_extent as f32 * scale) / 2.0;
        Some(GeoMapping {
            x_min,
            y_min,
            cos_lat,
            scale,
            x_off,
            y_off,
        })
    }

    fn to_pixel(&self, x: f64, y: f64, plot: &PlotBounds) -> Point {
        let px = plot.left + self.x_off + ((x - self.x_min) * self.cos_lat) as f32 * self.scale;
        let py = plot.bottom - self.y_off - (y - self.y_min) as f32 * self.scale;
        Point::new(px, py)
    }
}

/// Immutable, pre-rendered chart background plus the coordinate mapping needed
/// to draw the per-frame position marker.
pub struct ChartCache {
    /// Rendered chart background without any position markers.
    pub background: skia_safe::Image,
    /// X data (frame indices or lon values).
    pub x_data: Vec<f64>,
    /// Y data (elevation, lat, etc.).
    pub y_data: Vec<f64>,
    /// Activity distance in metres for each point. Populated for course plots.
    pub distance_data: Vec<f64>,
    /// Pixel position of the chart within the full frame.
    pub x_offset: i32,
    pub y_offset: i32,
    /// Data min/max for mapping data coords → pixel coords.
    pub x_min: f64,
    pub x_max: f64,
    pub y_min: f64,
    pub y_max: f64,
    /// Pixel bounds of the plot area inside the surface.
    pub plot_bounds: PlotBounds,
    /// Point configs from the template (colour, size, etc.).
    pub point_configs: Vec<crate::render::template::PointConfig>,
    /// Static markers placed along a course by activity distance.
    pub markers: Vec<CourseMarkerConfig>,
    /// Geographic mapping for course plots (None for non-GPS charts).
    pub geo: Option<GeoMapping>,
    /// The plotted attribute (e.g. "elevation") — drives point-label units.
    pub value_attr: String,
    /// Optional value label drawn next to the live marker.
    pub point_label: Option<PointLabelConfig>,
    /// Typeface for the point label, loaded once (None if no label).
    pub label_typeface: Option<Typeface>,
    /// For course plots: draw traveled portion at this opacity per-frame.
    pub past_opacity: Option<f32>,
    /// For course plots: full-route background drawn at this opacity; None = full opacity.
    pub future_opacity: Option<f32>,
    /// Line color string (needed for per-frame past-segment drawing).
    pub line_color: String,
    /// Line width (needed for per-frame past-segment drawing).
    pub line_width: f32,
}

impl ChartCache {
    pub fn build(
        config: &PlotConfig,
        x_data: Vec<f64>,
        y_data: Vec<f64>,
        distance_data: Vec<f64>,
        fonts_dir: &str,
    ) -> Option<Self> {
        if x_data.is_empty() || y_data.is_empty() {
            return None;
        }

        let surf_w = config.width as i32;
        let surf_h = config.height as i32;
        if surf_w <= 0 || surf_h <= 0 {
            return None;
        }

        let margin = config.margin_fraction();
        let is_course = config.value == crate::render::activity::ATTR_COURSE;
        // Course plots keep the margin inset so the route line and position dot
        // don't clip at the surface edge. Non-course plots (elevation, etc.) go
        // edge-to-edge so their bounding box aligns exactly with the rendered pixels.
        let plot_bounds = if is_course {
            let m = margin as f32;
            PlotBounds {
                left: m * surf_w as f32,
                right: surf_w as f32 - m * surf_w as f32,
                top: m * surf_h as f32,
                bottom: surf_h as f32 - m * surf_h as f32,
            }
        } else {
            PlotBounds {
                left: 0.0,
                right: surf_w as f32,
                top: 0.0,
                bottom: surf_h as f32,
            }
        };

        let x_min = x_data.iter().cloned().fold(f64::INFINITY, f64::min);
        let x_max = x_data.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let y_min = y_data.iter().cloned().fold(f64::INFINITY, f64::min);
        let y_max = y_data.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        // Course plots use geographic aspect-ratio correction; all others get vertical padding.
        let is_course = config.value == crate::render::activity::ATTR_COURSE;
        let geo = if is_course {
            GeoMapping::build(x_min, x_max, y_min, y_max, &plot_bounds)
        } else {
            None
        };

        // Add some vertical padding so the line doesn't hug the top/bottom edges.
        let y_pad = (y_max - y_min) * margin;
        let (y_min_out, y_max_out) = if is_course {
            (y_min, y_max)
        } else {
            (y_min - y_pad, y_max + y_pad)
        };

        let background = render_chart_background(
            surf_w,
            surf_h,
            &plot_bounds,
            &x_data,
            &y_data,
            &DataBounds {
                x_min,
                x_max,
                y_min: y_min_out,
                y_max: y_max_out,
            },
            config,
            geo.as_ref(),
        );

        // Load the point-label typeface once (None when no label configured).
        let point_label = config.point_label.clone();
        let label_typeface = point_label.as_ref().and_then(|pl| {
            let font = pl.font.as_deref().unwrap_or("Arial.ttf");
            crate::render::frame::load_typeface(font, fonts_dir)
        });

        let past_opacity = if is_course {
            config.line_past_opacity()
        } else {
            None
        };
        let future_opacity = if is_course {
            config.line_future_opacity()
        } else {
            None
        };

        Some(ChartCache {
            background,
            x_data,
            y_data,
            distance_data: if is_course { distance_data } else { Vec::new() },
            x_offset: config.x,
            y_offset: config.y,
            x_min,
            x_max,
            y_min: y_min_out,
            y_max: y_max_out,
            plot_bounds,
            point_configs: config.points.clone().unwrap_or_default(),
            markers: if is_course {
                config.markers.clone().unwrap_or_default()
            } else {
                Vec::new()
            },
            geo,
            value_attr: config.value.clone(),
            point_label,
            label_typeface,
            past_opacity,
            future_opacity,
            line_color: config.line_color(),
            line_width: config.line_width(),
        })
    }

    /// Map a data coordinate to a pixel position inside the chart surface.
    fn data_to_pixel(&self, x: f64, y: f64) -> Point {
        if let Some(geo) = &self.geo {
            return geo.to_pixel(x, y, &self.plot_bounds);
        }
        let px = self.plot_bounds.left
            + if self.x_max > self.x_min {
                ((x - self.x_min) / (self.x_max - self.x_min)) as f32 * self.plot_bounds.width()
            } else {
                0.0
            };
        let py = self.plot_bounds.bottom
            - if self.y_max > self.y_min {
                ((y - self.y_min) / (self.y_max - self.y_min)) as f32 * self.plot_bounds.height()
            } else {
                0.0
            };
        Point::new(px, py)
    }

    fn course_marker_point(&self, target_m: f64) -> Option<(Point, f32)> {
        self.geo.as_ref()?;
        if self.x_data.is_empty() || self.distance_data.is_empty() {
            return None;
        }
        let last = self
            .x_data
            .len()
            .min(self.y_data.len())
            .min(self.distance_data.len())
            .saturating_sub(1);
        if last == 0 {
            let pt = self.data_to_pixel(self.x_data[0], self.y_data[0]);
            return Some((
                Point::new(pt.x + self.x_offset as f32, pt.y + self.y_offset as f32),
                0.0,
            ));
        }

        let target = target_m.clamp(self.distance_data[0], self.distance_data[last]);
        let mut idx = 1;
        while idx <= last && self.distance_data[idx] < target {
            idx += 1;
        }
        let i0 = idx.saturating_sub(1).min(last);
        let i1 = idx.min(last);
        let d0 = self.distance_data[i0];
        let d1 = self.distance_data[i1];
        let frac = if d1 > d0 {
            ((target - d0) / (d1 - d0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let x = self.x_data[i0] + (self.x_data[i1] - self.x_data[i0]) * frac;
        let y = self.y_data[i0] + (self.y_data[i1] - self.y_data[i0]) * frac;
        let local_pt = self.data_to_pixel(x, y);
        let a = self.data_to_pixel(self.x_data[i0], self.y_data[i0]);
        let b = self.data_to_pixel(self.x_data[i1], self.y_data[i1]);
        let course_angle = (b.y - a.y).atan2(b.x - a.x).to_degrees();
        Some((
            Point::new(
                local_pt.x + self.x_offset as f32,
                local_pt.y + self.y_offset as f32,
            ),
            course_angle + 90.0,
        ))
    }

    fn draw_course_marker(&self, canvas: &Canvas, marker: &CourseMarkerConfig) {
        let Some(distance_m) = marker.distance else {
            return;
        };
        let Some((pt, perpendicular_angle)) = self.course_marker_point(distance_m) else {
            return;
        };
        let width = marker.width.unwrap_or(34.0).max(1.0);
        let height = marker.height.unwrap_or(10.0).max(1.0);
        let angle = perpendicular_angle + marker.rotation.unwrap_or(0.0);
        let opacity = Some(marker.opacity.unwrap_or(1.0));

        canvas.save();
        canvas.translate((pt.x, pt.y));
        canvas.rotate(angle, None);

        let left = -width / 2.0;
        let top = -height / 2.0;
        let style = marker.style.as_deref().unwrap_or("checkered");

        if style == "circle" {
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(to_skia_color(
                marker.color.as_deref().unwrap_or("#ef4444"),
                opacity,
            ));
            paint.set_style(PaintStyle::Fill);
            canvas.draw_circle((0.0, 0.0), width.min(height) / 2.0, &paint);
        } else if style == "rectangle" {
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(to_skia_color(
                marker.color.as_deref().unwrap_or("#22c55e"),
                opacity,
            ));
            paint.set_style(PaintStyle::Fill);
            canvas.draw_rect(Rect::from_xywh(left, top, width, height), &paint);
        } else {
            let rect = Rect::from_xywh(left, top, width, height);
            let cell = height.max(1.0) / 2.0;
            let cols = (width / cell).ceil() as i32;
            for row in 0..2 {
                for col in 0..cols {
                    let color = if (row + col) % 2 == 0 {
                        to_skia_color("#000000", opacity)
                    } else {
                        to_skia_color("#ffffff", opacity)
                    };
                    let mut paint = Paint::default();
                    paint.set_anti_alias(false);
                    paint.set_color(color);
                    paint.set_style(PaintStyle::Fill);
                    let x = left + col as f32 * cell;
                    let mut square =
                        Rect::from_xywh(x, top + row as f32 * cell, cell + 0.5, cell + 0.5);
                    if square.intersect(rect) {
                        canvas.draw_rect(square, &paint);
                    }
                }
            }
            let mut border = Paint::default();
            border.set_anti_alias(true);
            border.set_color(to_skia_color("#111111", opacity));
            border.set_style(PaintStyle::Stroke);
            border.set_stroke_width(1.0);
            canvas.draw_rect(rect, &border);
        }
        canvas.restore();
    }

    /// Draw onto a canvas: blit background then draw position marker for frame_idx.
    pub fn draw_on_canvas(&self, canvas: &Canvas, frame_idx: usize) {
        // 1. Composite the cached chart background.
        canvas.draw_image(
            &self.background,
            Point::new(self.x_offset as f32, self.y_offset as f32),
            None,
        );

        // 2. Overdraw the traveled (past) segment at past_opacity when split is active.
        if (self.past_opacity.is_some() || self.future_opacity.is_some())
            && frame_idx < self.x_data.len()
            && let Some(geo) = &self.geo
        {
            let past_end = frame_idx + 1;
            let past_opacity = self.past_opacity.unwrap_or(1.0);
            let past_color = to_skia_color(&self.line_color, Some(past_opacity));
            let mut pb = PathBuilder::new();
            for (i, (&x, &y)) in self
                .x_data
                .iter()
                .zip(self.y_data.iter())
                .take(past_end)
                .enumerate()
            {
                let local_pt = geo.to_pixel(x, y, &self.plot_bounds);
                let abs_pt = Point::new(
                    local_pt.x + self.x_offset as f32,
                    local_pt.y + self.y_offset as f32,
                );
                if i == 0 {
                    pb.move_to(abs_pt);
                } else {
                    pb.line_to(abs_pt);
                }
            }
            let path = pb.snapshot();
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(past_color);
            paint.set_stroke_width(self.line_width);
            paint.set_style(PaintStyle::Stroke);
            canvas.draw_path(&path, &paint);
        }

        // 3. Draw static course markers over the route.
        for marker in &self.markers {
            self.draw_course_marker(canvas, marker);
        }

        // 4. Draw position marker (the per-frame part).
        if frame_idx < self.x_data.len() {
            let x = self.x_data[frame_idx];
            let y = self.y_data.get(frame_idx).copied().unwrap_or(0.0);
            let local_pt = self.data_to_pixel(x, y);
            let abs_pt = Point::new(
                local_pt.x + self.x_offset as f32,
                local_pt.y + self.y_offset as f32,
            );

            for pc in &self.point_configs {
                let color = pc
                    .color
                    .as_deref()
                    .map(|c| to_skia_color(c, pc.opacity))
                    .unwrap_or(Color::WHITE);
                let radius = pc.weight.unwrap_or(80.0).sqrt() / 2.0; // weight is area → r = sqrt(w)/2

                let mut paint = Paint::default();
                paint.set_anti_alias(true);
                paint.set_color(color);
                paint.set_style(PaintStyle::Fill);
                canvas.draw_circle(abs_pt, radius, &paint);

                // Optionally draw edge stroke
                if pc.remove_edge_color.unwrap_or(false) {
                    // no edge
                } else if let Some(ec) = &pc.edge_color {
                    let mut ep = Paint::default();
                    ep.set_anti_alias(true);
                    ep.set_color(to_skia_color(ec, None));
                    ep.set_style(PaintStyle::Stroke);
                    ep.set_stroke_width(pc.edge_width.unwrap_or(1.0));
                    canvas.draw_circle(abs_pt, radius, &ep);
                }
            }

            // 5. Optional value label next to the marker (e.g. "960 M" /
            //    "3150 FT"), one line per unit, metric first.
            if let (Some(pl), Some(tf)) = (&self.point_label, &self.label_typeface) {
                let raw = self.y_data.get(frame_idx).copied().unwrap_or(0.0);
                let size = pl.font_size.unwrap_or(32.0);
                let font = crate::render::frame::font_from_typeface(
                    tf.clone(),
                    size,
                    pl.italic.unwrap_or(false),
                );
                let color = pl
                    .color
                    .as_deref()
                    .map(|c| to_skia_color(c, None))
                    .unwrap_or(Color::WHITE);
                let mut paint = Paint::default();
                paint.set_anti_alias(true);
                paint.set_color(color);

                let xo = pl.x_offset.unwrap_or(0.0);
                let yo = pl.y_offset.unwrap_or(0.0);
                let dec = pl.decimal_rounding.unwrap_or(0);
                let units = pl
                    .units
                    .clone()
                    .unwrap_or_else(|| vec!["metric".to_string()]);
                let (line_h, _) = font.metrics();
                let n = units.len() as f32;

                // Pre-format all lines and find max width to decide which side
                // to place the label block. Near the right edge the block flips
                // left so it never overflows the chart surface.
                let lines: Vec<String> = units
                    .iter()
                    .map(|unit| format_point_label(raw, &self.value_attr, unit, dec))
                    .collect();
                let max_text_w = lines
                    .iter()
                    .map(|t| font.measure_str(t.as_str(), Some(&paint)).0)
                    .fold(0.0_f32, f32::max);

                let chart_right = self.x_offset as f32 + self.plot_bounds.right;
                let flip_left = abs_pt.x + xo + max_text_w > chart_right;

                // Stack the block above the marker: last line sits `yo` above
                // the dot, earlier lines higher. When flipped, each line is
                // right-aligned to the left side of the marker.
                for (i, text) in lines.iter().enumerate() {
                    let text_w = font.measure_str(text.as_str(), Some(&paint)).0;
                    let label_x = if flip_left {
                        abs_pt.x - xo - text_w
                    } else {
                        abs_pt.x + xo
                    };
                    let baseline_y = abs_pt.y - yo - (n - 1.0 - i as f32) * line_h;
                    canvas.draw_str(text.as_str(), (label_x, baseline_y), &font, &paint);
                }
            }
        }
    }
}

/// Format a plotted value for a point label in the requested unit system,
/// producing "<number> <SUFFIX>" (e.g. "960 M", "3150 FT"). `raw` is the
/// attribute's native unit (elevation: metres, speed: m/s, temp: °C).
fn format_point_label(raw: f64, attr: &str, unit: &str, decimals: i32) -> String {
    let (conv, suffix) = units::resolve(attr, Some(unit));
    format!("{} {}", round_str(conv.apply(raw), decimals), suffix)
}

fn round_str(v: f64, decimals: i32) -> String {
    if decimals > 0 {
        format!("{:.*}", decimals as usize, v)
    } else {
        format!("{}", v.round() as i64)
    }
}

// ─── Background renderer ──────────────────────────────────────────────────

struct DataBounds {
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
}

#[allow(clippy::too_many_arguments)]
fn render_chart_background(
    surf_w: i32,
    surf_h: i32,
    plot_bounds: &PlotBounds,
    x_data: &[f64],
    y_data: &[f64],
    bounds: &DataBounds,
    config: &PlotConfig,
    geo: Option<&GeoMapping>,
) -> skia_safe::Image {
    let DataBounds {
        x_min,
        x_max,
        y_min,
        y_max,
    } = *bounds;
    let info = ImageInfo::new(
        ISize::new(surf_w, surf_h),
        skia_safe::ColorType::BGRA8888,
        skia_safe::AlphaType::Premul,
        None,
    );
    let mut surface =
        skia_safe::surfaces::raster(&info, None, None).expect("Failed to create Skia surface");
    let canvas = surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    let to_px = |x: f64, y: f64| -> Point {
        if let Some(g) = geo {
            return g.to_pixel(x, y, plot_bounds);
        }
        let px = plot_bounds.left
            + if x_max > x_min {
                ((x - x_min) / (x_max - x_min)) as f32 * plot_bounds.width()
            } else {
                0.0
            };
        let py = plot_bounds.bottom
            - if y_max > y_min {
                ((y - y_min) / (y_max - y_min)) as f32 * plot_bounds.height()
            } else {
                0.0
            };
        Point::new(px, py)
    };

    // Build the line path using PathBuilder (Path is immutable in skia-safe 0.93+)
    let mut pb = PathBuilder::new();
    for (i, (&x, &y)) in x_data.iter().zip(y_data.iter()).enumerate() {
        let pt = to_px(x, y);
        if i == 0 {
            pb.move_to(pt);
        } else {
            pb.line_to(pt);
        }
    }
    let line_path = pb.snapshot();

    // Draw fill under the curve
    if let Some(fill_opacity) = config.fill_opacity() {
        let fill_color_str = config.fill_color();
        let (r, g, b, _) = crate::render::color::parse_hex_color(&fill_color_str);
        let alpha = (fill_opacity.clamp(0.0, 1.0) * 255.0) as u8;
        let fill_color = Color::from_argb(alpha, r, g, b);

        let y_base = y_min;
        if let (Some(&last_x), Some(&first_x)) = (x_data.last(), x_data.first()) {
            let mut fb = PathBuilder::new_path(&line_path);
            fb.line_to(to_px(last_x, y_base));
            fb.line_to(to_px(first_x, y_base));
            fb.close();
            let fill_path = fb.snapshot();

            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_color(fill_color);
            paint.set_style(PaintStyle::Fill);
            canvas.draw_path(&fill_path, &paint);
        }
    }

    // Draw the line. When split opacities are configured the background shows
    // the full route at future_opacity; the past segment is overdrawn per-frame.
    let is_course = geo.is_some();
    let split_opacity = if is_course {
        config.line_future_opacity().or_else(|| {
            // past_opacity only → background at full opacity, past overdrawn per-frame
            config.line_past_opacity().map(|_| 1.0)
        })
    } else {
        None
    };
    let line_color = to_skia_color(&config.line_color(), split_opacity);
    let mut line_paint = Paint::default();
    line_paint.set_anti_alias(true);
    line_paint.set_color(line_color);
    line_paint.set_stroke_width(config.line_width());
    line_paint.set_style(PaintStyle::Stroke);
    canvas.draw_path(&line_path, &line_paint);

    surface.image_snapshot()
}

#[cfg(test)]
mod tests {
    use super::format_point_label;

    #[test]
    fn elevation_metric_and_imperial_match_screenshot_format() {
        // 960 m -> "960 M"; 960 * 3.28084 = 3149.6 -> "3150 FT"
        assert_eq!(format_point_label(960.0, "elevation", "metric", 0), "960 M");
        assert_eq!(
            format_point_label(960.0, "elevation", "imperial", 0),
            "3150 FT"
        );
    }

    #[test]
    fn speed_temperature_and_decimals() {
        assert_eq!(format_point_label(10.0, "speed", "metric", 0), "36 KM/H");
        assert_eq!(format_point_label(10.0, "speed", "imperial", 0), "22 MPH");
        assert_eq!(
            format_point_label(0.0, "temperature", "imperial", 0),
            "32 F"
        );
        assert_eq!(
            format_point_label(959.74, "elevation", "metric", 1),
            "959.7 M"
        );
    }

    #[test]
    fn unknown_attribute_echoes_unit_uppercased() {
        assert_eq!(format_point_label(5.0, "power", "watts", 0), "5 WATTS");
    }

    #[test]
    fn precise_unit_tokens() {
        assert_eq!(format_point_label(10.0, "speed", "kmh", 0), "36 KM/H");
        assert_eq!(format_point_label(10.0, "speed", "mph", 0), "22 MPH");
        assert_eq!(format_point_label(10.0, "speed", "ms", 0), "10 M/S");
        assert_eq!(format_point_label(5000.0, "distance", "km", 0), "5 KM");
        assert_eq!(format_point_label(5000.0, "distance", "m", 0), "5000 M");
        assert_eq!(format_point_label(1609.34, "distance", "mi", 0), "1 MI");
        assert_eq!(format_point_label(960.0, "elevation", "ft", 0), "3150 FT");
        assert_eq!(format_point_label(0.0, "temperature", "f", 0), "32 F");
        assert_eq!(format_point_label(20.0, "temperature", "c", 0), "20 C");
    }
}
