//! Single source of truth for metric → display-unit conversion.
//!
//! GPX-native units are fixed: speed m/s, distance m, elevation m,
//! temperature °C. Every render path (value elements in `frame.rs`, chart
//! point labels in `chart.rs`) resolves through [`resolve`] so the conversion
//! and suffix never drift between code paths.

use crate::render::activity::{
    ATTR_DISTANCE, ATTR_ELEVATION, ATTR_SPEED, ATTR_TEMPERATURE, FT_CONVERSION, KMH_CONVERSION,
    MI_CONVERSION, MPH_CONVERSION,
};

/// Affine conversion from a GPX-native value to a display value:
/// `display = raw * scale + offset`. `offset` is non-zero only for
/// temperature (°C → °F).
#[derive(Clone, Copy, Debug)]
pub struct Conversion {
    pub scale: f64,
    pub offset: f64,
}

impl Conversion {
    pub const IDENTITY: Conversion = Conversion {
        scale: 1.0,
        offset: 0.0,
    };

    fn scale(scale: f64) -> Conversion {
        Conversion { scale, offset: 0.0 }
    }

    pub fn apply(&self, raw: f64) -> f64 {
        raw * self.scale + self.offset
    }
}

/// Resolve a metric attribute + unit token into its conversion and an
/// uppercase display suffix (e.g. `"KM/H"`, `"FT"`).
///
/// Accepts the precise per-metric tokens (`"kmh"`, `"mph"`, `"ms"`, `"km"`,
/// `"mi"`, `"m"`, `"ft"`, `"c"`, `"f"`), the legacy `"metric"`/`"imperial"`
/// tokens, and `None` (→ metric default) — so every existing template keeps
/// rendering unchanged. Metrics with no unit choice (gradient, power,
/// cadence, heartrate) and unknown attributes return the identity conversion
/// and echo the provided token uppercased.
pub fn resolve(attr: &str, unit: Option<&str>) -> (Conversion, String) {
    let u = unit.unwrap_or("").to_ascii_lowercase();
    match attr {
        ATTR_SPEED => match u.as_str() {
            "ms" | "m/s" => (Conversion::scale(1.0), "M/S".into()),
            "mph" | "imperial" => (Conversion::scale(MPH_CONVERSION), "MPH".into()),
            _ => (Conversion::scale(KMH_CONVERSION), "KM/H".into()), // kmh / metric / default
        },
        ATTR_DISTANCE => match u.as_str() {
            "m" => (Conversion::scale(1.0), "M".into()),
            "mi" | "imperial" => (Conversion::scale(MI_CONVERSION), "MI".into()),
            _ => (Conversion::scale(0.001), "KM".into()), // km / metric / default
        },
        ATTR_ELEVATION => match u.as_str() {
            "ft" | "imperial" => (Conversion::scale(FT_CONVERSION), "FT".into()),
            _ => (Conversion::scale(1.0), "M".into()), // m / metric / default
        },
        ATTR_TEMPERATURE => match u.as_str() {
            "f" | "imperial" => (
                Conversion {
                    scale: 1.8,
                    offset: 32.0,
                },
                "F".into(),
            ),
            _ => (Conversion::IDENTITY, "C".into()), // c / metric / default
        },
        _ => (Conversion::IDENTITY, u.to_uppercase()),
    }
}

/// Convert a display-unit distance target back to metres (used by the
/// "until_custom" distance-reference mode). Inverse of the distance branch of
/// [`resolve`]; distance has no offset so this is a plain divide.
pub fn distance_target_to_m(target: f64, unit: Option<&str>) -> f64 {
    let (conv, _) = resolve(ATTR_DISTANCE, unit);
    target / conv.scale
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_tokens_match_precise_tokens() {
        // metric/None map to the metric default; imperial to the imperial unit.
        for (attr, metric, imperial) in [
            (ATTR_SPEED, "kmh", "mph"),
            (ATTR_DISTANCE, "km", "mi"),
            (ATTR_ELEVATION, "m", "ft"),
            (ATTR_TEMPERATURE, "c", "f"),
        ] {
            let none = resolve(attr, None);
            let met = resolve(attr, Some("metric"));
            let met_precise = resolve(attr, Some(metric));
            let imp = resolve(attr, Some("imperial"));
            let imp_precise = resolve(attr, Some(imperial));
            assert_eq!(none.0.scale, met_precise.0.scale, "{attr} None vs metric");
            assert_eq!(met.0.scale, met_precise.0.scale, "{attr} metric");
            assert_eq!(imp.0.scale, imp_precise.0.scale, "{attr} imperial");
            assert_eq!(imp.0.offset, imp_precise.0.offset, "{attr} imperial offset");
        }
    }

    #[test]
    fn distance_target_round_trips() {
        assert!((distance_target_to_m(5.0, Some("km")) - 5000.0).abs() < 1e-6);
        assert!((distance_target_to_m(800.0, Some("m")) - 800.0).abs() < 1e-6);
        assert!((distance_target_to_m(1.0, Some("mi")) - 1609.34).abs() < 1.0);
        assert!((distance_target_to_m(5.0, Some("metric")) - 5000.0).abs() < 1e-6);
        assert!((distance_target_to_m(1.0, Some("imperial")) - 1609.34).abs() < 1.0);
    }

    #[test]
    fn temperature_is_affine() {
        let (c, _) = resolve(ATTR_TEMPERATURE, Some("f"));
        assert!((c.apply(0.0) - 32.0).abs() < 1e-9);
        assert!((c.apply(100.0) - 212.0).abs() < 1e-9);
    }
}
