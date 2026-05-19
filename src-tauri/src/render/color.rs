/// Parse a CSS hex color string (#rgb, #rrggbb, #rrggbbaa) into (r, g, b, a) bytes.
pub fn parse_hex_color(hex: &str) -> (u8, u8, u8, u8) {
    let s = hex.trim_start_matches('#');
    match s.len() {
        3 => {
            let r = u8::from_str_radix(&s[0..1].repeat(2), 16).unwrap_or(255);
            let g = u8::from_str_radix(&s[1..2].repeat(2), 16).unwrap_or(255);
            let b = u8::from_str_radix(&s[2..3].repeat(2), 16).unwrap_or(255);
            (r, g, b, 255)
        }
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(255);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(255);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(255);
            (r, g, b, 255)
        }
        8 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(255);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(255);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(255);
            let a = u8::from_str_radix(&s[6..8], 16).unwrap_or(255);
            (r, g, b, a)
        }
        _ => (255, 255, 255, 255),
    }
}

/// Apply opacity to a color (if color has no embedded alpha or color is 6-char hex).
pub fn hex_with_opacity(hex: &str, opacity: Option<f32>) -> (u8, u8, u8, u8) {
    let (r, g, b, a) = parse_hex_color(hex);
    match opacity {
        // 8-char hex already has alpha embedded — don't override
        Some(op) if hex.trim_start_matches('#').len() != 8 => {
            let alpha = (op.clamp(0.0, 1.0) * 255.0).round() as u8;
            (r, g, b, alpha)
        }
        _ => (r, g, b, a),
    }
}

/// Sample an ordered list of hex color stops at position `t` in [0, 1],
/// linearly interpolating between adjacent stops. Empty -> white.
pub fn lerp_gradient(stops: &[String], t: f32, opacity: Option<f32>) -> (u8, u8, u8, u8) {
    match stops.len() {
        0 => {
            let a = opacity
                .map(|o| (o.clamp(0.0, 1.0) * 255.0).round() as u8)
                .unwrap_or(255);
            (255, 255, 255, a)
        }
        1 => hex_with_opacity(&stops[0], opacity),
        n => {
            let t = t.clamp(0.0, 1.0);
            let scaled = t * (n - 1) as f32;
            let i = (scaled.floor() as usize).min(n - 2);
            let f = scaled - i as f32;
            let (r0, g0, b0, a0) = hex_with_opacity(&stops[i], opacity);
            let (r1, g1, b1, a1) = hex_with_opacity(&stops[i + 1], opacity);
            let lerp = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * f).round() as u8;
            (lerp(r0, r1), lerp(g0, g1), lerp(b0, b1), lerp(a0, a1))
        }
    }
}

pub fn to_skia_color(hex: &str, opacity: Option<f32>) -> skia_safe::Color {
    let (r, g, b, a) = hex_with_opacity(hex, opacity);
    skia_safe::Color::from_argb(a, r, g, b)
}
