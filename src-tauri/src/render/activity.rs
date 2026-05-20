use quick_xml::events::Event;
use quick_xml::reader::Reader;

pub const ATTR_CADENCE: &str = "cadence";
pub const ATTR_COURSE: &str = "course";
pub const ATTR_DISTANCE: &str = "distance";
pub const ATTR_ELEVATION: &str = "elevation";
pub const ATTR_GRADIENT: &str = "gradient";
pub const ATTR_HEARTRATE: &str = "heartrate";
pub const ATTR_POWER: &str = "power";
pub const ATTR_SPEED: &str = "speed";
pub const ATTR_TIME: &str = "time";
pub const ATTR_TEMPERATURE: &str = "temperature";

pub const MPH_CONVERSION: f64 = 2.23694;
pub const KMH_CONVERSION: f64 = 3.6;
pub const FT_CONVERSION: f64 = 3.28084;
pub const MI_CONVERSION: f64 = 0.001 / 1.60934; // metres to miles
pub const GRADIENT_SCALE: f64 = 1.747;

#[derive(Debug, Clone, Default)]
pub struct Activity {
    pub course: Vec<(f64, f64)>,
    pub distance: Vec<f64>,
    pub elevation: Vec<f64>,
    pub gradient: Vec<f64>,
    pub heartrate: Vec<f64>,
    pub speed: Vec<f64>,
    pub cadence: Vec<f64>,
    pub power: Vec<f64>,
    pub temperature: Vec<f64>,
    pub valid_attributes: Vec<String>,
    /// Total cumulative distance (metres) of the full activity before any trim.
    pub total_activity_distance: f64,
}

impl Activity {
    pub fn from_gpx(path: &str) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read GPX file: {e}"))?;
        Self::parse_gpx(&content)
    }

    /// Dispatch to the correct parser based on file extension.
    pub fn from_file(path: &str) -> Result<Self, String> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "fit" => Self::from_fit(path),
            "tcx" => {
                let content = std::fs::read_to_string(path)
                    .map_err(|e| format!("Failed to read TCX file: {e}"))?;
                Self::parse_tcx(&content)
            }
            _ => Self::from_gpx(path),
        }
    }

    pub fn from_fit(path: &str) -> Result<Self, String> {
        use fitparser::profile::MesgNum;
        use std::fs::File;
        use std::io::BufReader;

        let file = File::open(path).map_err(|e| format!("Failed to open FIT file: {e}"))?;
        let mut reader = BufReader::new(file);
        let records = fitparser::from_reader(&mut reader)
            .map_err(|e| format!("Failed to parse FIT file: {e}"))?;

        let mut points: Vec<TrackPoint> = Vec::new();

        for record in records {
            if record.kind() != MesgNum::Record {
                continue;
            }
            let mut lat: Option<f64> = None;
            let mut lon: Option<f64> = None;
            let mut elevation: Option<f64> = None;
            let mut heartrate: Option<f64> = None;
            let mut cadence: Option<f64> = None;
            let mut power: Option<f64> = None;
            let mut temperature: Option<f64> = None;
            let mut time_str: Option<String> = None;

            for field in record.fields() {
                match field.name() {
                    "position_lat" => {
                        // FIT stores lat/lon as semicircles (SInt32); convert to degrees.
                        lat = fit_f64(field.value()).map(|v| v * SEMICIRCLES_TO_DEG);
                    }
                    "position_long" => {
                        lon = fit_f64(field.value()).map(|v| v * SEMICIRCLES_TO_DEG);
                    }
                    "altitude" | "enhanced_altitude" => {
                        if elevation.is_none() {
                            elevation = fit_f64(field.value());
                        }
                    }
                    "heart_rate" => heartrate = fit_f64(field.value()),
                    "cadence" => cadence = fit_f64(field.value()),
                    "power" => power = fit_f64(field.value()),
                    "temperature" => temperature = fit_f64(field.value()),
                    "timestamp" => {
                        if let fitparser::Value::Timestamp(dt) = field.value() {
                            time_str = Some(dt.to_rfc3339());
                        }
                    }
                    _ => {}
                }
            }

            if let (Some(lat), Some(lon)) = (lat, lon) {
                points.push(TrackPoint {
                    lat,
                    lon,
                    elevation,
                    time_str,
                    heartrate,
                    cadence,
                    power,
                    temperature,
                });
            }
        }

        if points.is_empty() {
            return Err("No GPS track points found in FIT file. \
                 Indoor activities without GPS are not supported."
                .to_string());
        }

        Self::build_from_points(points)
    }

    pub fn parse_tcx(content: &str) -> Result<Self, String> {
        let mut reader = Reader::from_str(content);
        reader.config_mut().trim_text(true);

        let mut points: Vec<TrackPoint> = Vec::new();
        let mut current: Option<TrackPoint> = None;
        let mut in_trackpoint = false;
        let mut in_position = false;
        let mut in_heartrate = false;
        let mut in_extensions = false;
        let mut has_position = false;
        let mut current_text = String::new();
        let mut buf = Vec::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                    let ename = e.name();
                    let local = local_name(ename.as_ref());
                    match local {
                        "Trackpoint" => {
                            current = Some(TrackPoint::default());
                            in_trackpoint = true;
                            has_position = false;
                            in_position = false;
                            in_heartrate = false;
                            in_extensions = false;
                        }
                        "Position" if in_trackpoint => in_position = true,
                        "HeartRateBpm" if in_trackpoint => in_heartrate = true,
                        "Extensions" if in_trackpoint => in_extensions = true,
                        _ => {}
                    }
                    current_text.clear();
                }
                Ok(Event::Text(e)) => {
                    if let Ok(t) = e.unescape() {
                        current_text = t.to_string();
                    }
                }
                Ok(Event::End(ref e)) => {
                    let ename = e.name();
                    let local = local_name(ename.as_ref());
                    if let Some(ref mut pt) = current {
                        match local {
                            "LatitudeDegrees" if in_position => {
                                pt.lat = current_text.parse().unwrap_or(0.0);
                                has_position = true;
                            }
                            "LongitudeDegrees" if in_position => {
                                pt.lon = current_text.parse().unwrap_or(0.0);
                            }
                            "AltitudeMeters" => {
                                pt.elevation = current_text.parse().ok();
                            }
                            "Time" if in_trackpoint => {
                                pt.time_str = Some(current_text.clone());
                            }
                            "Value" if in_heartrate => {
                                pt.heartrate = current_text.parse().ok();
                            }
                            "Cadence" | "RunCadence" => {
                                pt.cadence = current_text.parse().ok();
                            }
                            "Watts" | "PowerInWatts" if in_extensions => {
                                pt.power = current_text.parse().ok();
                            }
                            "Position" => in_position = false,
                            "HeartRateBpm" => in_heartrate = false,
                            "Extensions" => in_extensions = false,
                            "Trackpoint" => {
                                in_trackpoint = false;
                                if let Some(pt) = current.take() {
                                    if has_position {
                                        points.push(pt);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    current_text.clear();
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parse error: {e}")),
                _ => {}
            }
            buf.clear();
        }

        if points.is_empty() {
            return Err("No track points found in TCX file".to_string());
        }

        Self::build_from_points(points)
    }

    /// Plausible sample ride used for the WYSIWYG preview when no GPX is
    /// loaded. Avoids shipping a bundled demo file: every metric is populated
    /// so any template element has something to render.
    pub fn synthetic(secs: usize) -> Self {
        let n = secs.max(1);
        let mut a = Activity::default();
        let mut cum_dist = 0.0;
        for i in 0..n {
            let t = i as f64;
            let spd = 8.0 + 3.0 * (t / 10.0).sin();
            if i > 0 {
                cum_dist += spd; // 1-second intervals
            }
            a.speed.push(spd);
            a.power.push(200.0 + 60.0 * (t / 8.0).sin());
            a.heartrate.push(140.0 + 15.0 * (t / 12.0).sin());
            a.cadence.push(88.0 + 6.0 * (t / 6.0).sin());
            a.elevation.push(100.0 + 20.0 * (t / 15.0).sin());
            a.gradient.push(3.0 * (t / 15.0).cos());
            a.temperature.push(21.0);
            a.course
                .push((37.0 + t * 1.0e-4, -122.0 + (t / 20.0).sin() * 1.0e-3));
            a.distance.push(cum_dist);
        }
        a.total_activity_distance = cum_dist;
        a.valid_attributes = [
            ATTR_COURSE,
            ATTR_DISTANCE,
            ATTR_SPEED,
            ATTR_ELEVATION,
            ATTR_GRADIENT,
            ATTR_HEARTRATE,
            ATTR_CADENCE,
            ATTR_POWER,
            ATTR_TEMPERATURE,
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        a
    }

    pub fn parse_gpx(content: &str) -> Result<Self, String> {
        let mut reader = Reader::from_str(content);
        reader.config_mut().trim_text(true);

        let mut points: Vec<TrackPoint> = Vec::new();
        let mut current: Option<TrackPoint> = None;
        let mut in_extensions = false;
        let mut in_tpx = false; // inside TrackPointExtension container
        let mut current_point_tag = String::new(); // "trkpt" or "wpt"
        let mut current_text = String::new();
        let mut buf = Vec::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                    let ename = e.name();
                    let local = local_name(ename.as_ref());

                    match local {
                        "trkpt" | "wpt" => {
                            let lat = attr_f64(e, b"lat").unwrap_or(0.0);
                            let lon = attr_f64(e, b"lon").unwrap_or(0.0);
                            current = Some(TrackPoint {
                                lat,
                                lon,
                                ..Default::default()
                            });
                            current_point_tag = local.to_string();
                            in_extensions = false;
                            in_tpx = false;
                        }
                        "extensions" => {
                            in_extensions = true;
                        }
                        "TrackPointExtension" => {
                            in_tpx = true;
                        }
                        _ => {}
                    }
                    current_text.clear();
                }
                Ok(Event::Text(e)) => {
                    if let Ok(t) = e.unescape() {
                        current_text = t.to_string();
                    }
                }
                Ok(Event::End(ref e)) => {
                    let ename = e.name();
                    let local = local_name(ename.as_ref());

                    if let Some(ref mut pt) = current {
                        match local {
                            "ele" if !in_extensions => {
                                pt.elevation = current_text.parse().ok();
                            }
                            "time" if !in_extensions => {
                                pt.time_str = Some(current_text.clone());
                            }
                            "hr" if in_tpx => {
                                pt.heartrate = current_text.parse().ok();
                            }
                            "cad" if in_tpx => {
                                pt.cadence = current_text.parse().ok();
                            }
                            "atemp" if in_tpx => {
                                pt.temperature = current_text.parse().ok();
                            }
                            // Power appears both as bare <power> or <PowerInWatts> in extensions
                            "power" | "PowerInWatts" | "watts" => {
                                pt.power = current_text.parse().ok();
                            }
                            "TrackPointExtension" => {
                                in_tpx = false;
                            }
                            "extensions" => {
                                in_extensions = false;
                            }
                            tag if !current_point_tag.is_empty() && tag == current_point_tag => {
                                if let Some(pt) = current.take() {
                                    points.push(pt);
                                }
                                current_point_tag.clear();
                            }
                            _ => {}
                        }
                    }
                    current_text.clear();
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(format!("XML parse error: {e}")),
                _ => {}
            }
            buf.clear();
        }

        if points.is_empty() {
            return Err("No track points found in GPX file".to_string());
        }

        Self::build_from_points(points)
    }

    fn build_from_points(points: Vec<TrackPoint>) -> Result<Self, String> {
        let n = points.len();
        let mut activity = Activity::default();

        // Detect valid attributes by scanning all points (any() short-circuits).
        // Sampling only 3 indices was unreliable — an attribute absent at the sample
        // points but present elsewhere would be wrongly excluded, causing trim() panics
        // after interpolate() expanded speed but not the missed attribute's vec.
        let mut valid: std::collections::HashSet<String> = std::collections::HashSet::new();
        valid.insert(ATTR_COURSE.into());
        valid.insert(ATTR_DISTANCE.into());
        valid.insert(ATTR_SPEED.into());
        if points.iter().any(|p| p.elevation.is_some()) {
            valid.insert(ATTR_ELEVATION.into());
        }
        if points.iter().any(|p| p.time_str.is_some()) {
            valid.insert(ATTR_TIME.into());
        }
        if points.iter().any(|p| p.heartrate.is_some()) {
            valid.insert(ATTR_HEARTRATE.into());
        }
        if points.iter().any(|p| p.cadence.is_some()) {
            valid.insert(ATTR_CADENCE.into());
        }
        if points.iter().any(|p| p.power.is_some()) {
            valid.insert(ATTR_POWER.into());
        }
        if points.iter().any(|p| p.temperature.is_some()) {
            valid.insert(ATTR_TEMPERATURE.into());
        }

        if valid.contains(ATTR_COURSE) && valid.contains(ATTR_ELEVATION) {
            valid.insert(ATTR_GRADIENT.into());
        }

        activity.valid_attributes = valid.into_iter().collect();
        activity.valid_attributes.sort(); // deterministic order

        // Build raw data arrays
        let mut raw_gradient: Vec<f64> = Vec::with_capacity(n);
        let mut cum_dist = 0.0f64;

        for (i, pt) in points.iter().enumerate() {
            activity.course.push((pt.lat, pt.lon));
            activity.elevation.push(pt.elevation.unwrap_or(0.0));
            activity.heartrate.push(pt.heartrate.unwrap_or(0.0));
            activity.cadence.push(pt.cadence.unwrap_or(0.0));
            activity.power.push(pt.power.unwrap_or(0.0));
            activity.temperature.push(pt.temperature.unwrap_or(0.0));

            // Speed: distance/time between consecutive points
            let spd = if i == 0 {
                0.0
            } else {
                let prev = &points[i - 1];
                let dist = haversine_m(prev.lat, prev.lon, pt.lat, pt.lon);
                let dt = time_delta_seconds(prev.time_str.as_deref(), pt.time_str.as_deref());
                if dt > 0.0 {
                    dist / dt
                } else {
                    0.0
                }
            };
            activity.speed.push(spd);

            // Cumulative distance from activity start
            if i > 0 {
                let prev = &points[i - 1];
                cum_dist += haversine_m(prev.lat, prev.lon, pt.lat, pt.lon);
            }
            activity.distance.push(cum_dist);

            // Gradient: elevation angle in degrees
            let grad = if i == 0 {
                None
            } else {
                let prev = &points[i - 1];
                if let (Some(e1), Some(e2)) = (prev.elevation, pt.elevation) {
                    let d = haversine_m(prev.lat, prev.lon, pt.lat, pt.lon);
                    if d > 0.0 {
                        Some(((e2 - e1) / d).atan().to_degrees())
                    } else {
                        Some(0.0)
                    }
                } else {
                    Some(0.0)
                }
            };
            raw_gradient.push(grad.unwrap_or(0.0));
        }

        // Smooth elevation with Savitzky-Golay (window=11, poly=3)
        if activity
            .valid_attributes
            .contains(&ATTR_ELEVATION.to_string())
        {
            activity.elevation = savgol_smooth_11_3(&activity.elevation);
        }

        // Smooth gradient: outlier removal + LOWESS-like + scale factor
        if activity
            .valid_attributes
            .contains(&ATTR_GRADIENT.to_string())
        {
            let mut grad = raw_gradient;
            // Fix first point: extrapolate from next two
            if grad.len() >= 3 {
                grad[0] = 2.0 * grad[1] - grad[2];
            }
            grad = handle_outliers(&grad, 2.0, 7);
            grad = lowess_smooth(&grad, 0.0005);
            activity.gradient = grad.iter().map(|&v| v * GRADIENT_SCALE).collect();
        }

        activity.total_activity_distance = cum_dist;
        Ok(activity)
    }

    /// Expand data density by linear interpolation for smooth per-frame values.
    pub fn interpolate(&mut self, fps: u32) {
        let fps = fps as usize;
        let skip = ATTR_TIME;

        for attr in self.valid_attributes.clone() {
            if attr == skip {
                continue;
            }
            match attr.as_str() {
                ATTR_COURSE => {
                    let lats: Vec<f64> = self.course.iter().map(|c| c.0).collect();
                    let lons: Vec<f64> = self.course.iter().map(|c| c.1).collect();
                    let new_lats = linear_interp(&lats, fps);
                    let new_lons = linear_interp(&lons, fps);
                    self.course = new_lats.into_iter().zip(new_lons).collect();
                }
                ATTR_DISTANCE => {
                    self.distance = linear_interp(&self.distance, fps);
                }
                ATTR_ELEVATION => {
                    self.elevation = linear_interp(&self.elevation, fps);
                }
                ATTR_GRADIENT => {
                    self.gradient = linear_interp(&self.gradient, fps);
                }
                ATTR_HEARTRATE => {
                    self.heartrate = linear_interp(&self.heartrate, fps);
                }
                ATTR_SPEED => {
                    self.speed = linear_interp(&self.speed, fps);
                }
                ATTR_CADENCE => {
                    self.cadence = linear_interp(&self.cadence, fps);
                }
                ATTR_POWER => {
                    self.power = linear_interp(&self.power, fps);
                }
                ATTR_TEMPERATURE => {
                    self.temperature = linear_interp(&self.temperature, fps);
                }
                _ => {}
            }
        }
    }

    pub fn trim(&mut self, start: usize, end: usize) -> Result<(), String> {
        let len = self.speed.len();
        if start >= len {
            return Err(format!("start ({start}) >= data length ({len})"));
        }
        if end > len || end <= start {
            return Err(format!(
                "end ({end}) out of range (must be > {start} and <= {len})"
            ));
        }
        // Each field is clamped to its own length: if valid_attributes detection
        // missed an attribute (or a field was never interpolated), we don't panic —
        // get_scalar() uses .get() which returns 0.0 for out-of-range indices anyway.
        fn tv<T: Clone>(v: &mut Vec<T>, s: usize, e: usize) {
            let e = e.min(v.len());
            let s = s.min(e);
            *v = v[s..e].to_vec();
        }
        tv(&mut self.course, start, end);
        tv(&mut self.distance, start, end);
        tv(&mut self.elevation, start, end);
        tv(&mut self.gradient, start, end);
        tv(&mut self.heartrate, start, end);
        tv(&mut self.speed, start, end);
        tv(&mut self.cadence, start, end);
        tv(&mut self.power, start, end);
        tv(&mut self.temperature, start, end);
        Ok(())
    }

    pub fn data_len(&self) -> usize {
        self.speed.len()
    }

    pub fn get_scalar(&self, attribute: &str, index: usize) -> f64 {
        let safe = |v: &[f64]| v.get(index).copied().unwrap_or(0.0);
        match attribute {
            ATTR_DISTANCE => safe(&self.distance),
            ATTR_ELEVATION => safe(&self.elevation),
            ATTR_GRADIENT => safe(&self.gradient),
            ATTR_HEARTRATE => safe(&self.heartrate),
            ATTR_SPEED => safe(&self.speed),
            ATTR_CADENCE => safe(&self.cadence),
            ATTR_POWER => safe(&self.power),
            ATTR_TEMPERATURE => safe(&self.temperature),
            _ => 0.0,
        }
    }

    /// Distance in metres adjusted for the requested reference point.
    /// `reference` values: "overlay_start" (default), "activity_start",
    /// "overlay_end", "activity_end", "custom".
    /// `target_m`: for "custom" only — the finish-line distance in metres.
    pub fn get_distance(
        &self,
        reference: Option<&str>,
        target_m: Option<f64>,
        index: usize,
    ) -> f64 {
        let current = self.distance.get(index).copied().unwrap_or(0.0);
        let overlay_start = self.distance.first().copied().unwrap_or(0.0);
        let overlay_end = self.distance.last().copied().unwrap_or(0.0);
        match reference.unwrap_or("overlay_start") {
            "activity_start" => current,
            "overlay_end" => (overlay_end - current).max(0.0),
            "activity_end" => (self.total_activity_distance - current).max(0.0),
            "custom" => target_m.map(|t| (t - current).max(0.0)).unwrap_or(0.0),
            _ => (current - overlay_start).max(0.0), // "overlay_start"
        }
    }

    /// Build (x, y) data arrays for a plot of the given attribute.
    pub fn plot_data(&self, attribute: &str) -> (Vec<f64>, Vec<f64>) {
        let scalar = |data: &[f64]| -> (Vec<f64>, Vec<f64>) {
            let x: Vec<f64> = (0..data.len()).map(|i| i as f64).collect();
            (x, data.to_vec())
        };
        match attribute {
            ATTR_DISTANCE => scalar(&self.distance),
            ATTR_ELEVATION => scalar(&self.elevation),
            ATTR_HEARTRATE => scalar(&self.heartrate),
            ATTR_SPEED => scalar(&self.speed),
            ATTR_CADENCE => scalar(&self.cadence),
            ATTR_POWER => scalar(&self.power),
            ATTR_TEMPERATURE => scalar(&self.temperature),
            ATTR_GRADIENT => scalar(&self.gradient),
            ATTR_COURSE => {
                let x: Vec<f64> = self.course.iter().map(|c| c.1).collect(); // lon
                let y: Vec<f64> = self.course.iter().map(|c| c.0).collect(); // lat
                (x, y)
            }
            _ => (vec![], vec![]),
        }
    }
}

// ─── Raw track point from XML ──────────────────────────────────────────────

#[derive(Default)]
struct TrackPoint {
    lat: f64,
    lon: f64,
    elevation: Option<f64>,
    time_str: Option<String>,
    heartrate: Option<f64>,
    cadence: Option<f64>,
    power: Option<f64>,
    temperature: Option<f64>,
}

// ─── Smoothing algorithms ──────────────────────────────────────────────────

/// Savitzky-Golay filter, window=11, poly=3. Coefficients from standard tables.
fn savgol_smooth_11_3(data: &[f64]) -> Vec<f64> {
    let n = data.len();
    if n < 11 {
        return data.to_vec();
    }
    // Precomputed SG coefficients for window=11, poly=3, derivative=0
    const COEFFS: [f64; 11] = [
        -0.08391608,
        0.02097902,
        0.10256410,
        0.16083916,
        0.19580420,
        0.20745921,
        0.19580420,
        0.16083916,
        0.10256410,
        0.02097902,
        -0.08391608,
    ];
    // Derived as [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36] / 429.0
    let half = 5usize;
    let mut result = Vec::with_capacity(n);

    for i in 0..n {
        let mut val = 0.0f64;
        for (k, &c) in COEFFS.iter().enumerate() {
            let src = if i + k < half {
                // Reflect at left boundary
                half - (i + k) - 1
            } else if i + k - half >= n {
                // Reflect at right boundary
                2 * (n - 1) - (i + k - half)
            } else {
                i + k - half
            };
            val += c * data[src.min(n - 1)];
        }
        result.push(val);
    }
    result
}

/// Z-score outlier detection with sliding window; replaces outliers with window mean.
fn handle_outliers(data: &[f64], z_threshold: f64, window: usize) -> Vec<f64> {
    let mut out = data.to_vec();
    let n = data.len();
    for i in 0..n.saturating_sub(window - 1) {
        let w = &data[i..i + window];
        let mean = w.iter().sum::<f64>() / w.len() as f64;
        let var = w.iter().map(|&v| (v - mean).powi(2)).sum::<f64>() / w.len() as f64;
        let std = var.sqrt();
        if std < 1e-10 {
            continue;
        }
        for j in 0..window {
            let z = (data[i + j] - mean).abs() / std;
            if z > z_threshold {
                out[i + j] = mean;
            }
        }
    }
    out
}

/// Lightweight LOWESS approximation using tricubic-weighted local linear regression.
/// With smooth_fraction=0.0005, bandwidth is tiny (~3 points), matching the Python implementation.
fn lowess_smooth(data: &[f64], smooth_fraction: f64) -> Vec<f64> {
    let n = data.len();
    let bandwidth = ((smooth_fraction * n as f64).round() as usize).max(3);
    let half_bw = bandwidth / 2;
    let mut result = Vec::with_capacity(n);

    for i in 0..n {
        let start = i.saturating_sub(half_bw);
        let end = (start + bandwidth).min(n);
        let start = end.saturating_sub(bandwidth);

        let len = end - start;
        let center = i - start;
        let max_dist = (len as f64) / 2.0;

        let mut sw = 0.0f64;
        let mut sx = 0.0f64;
        let mut sy = 0.0f64;
        let mut sxx = 0.0f64;
        let mut sxy = 0.0f64;

        for j in 0..len {
            let d = ((j as f64 - center as f64) / max_dist).abs().min(1.0);
            // Tricubic weight
            let w = (1.0 - d.powi(3)).powi(3);
            let x = j as f64;
            let y = data[start + j];
            sw += w;
            sx += w * x;
            sy += w * y;
            sxx += w * x * x;
            sxy += w * x * y;
        }

        let denom = sw * sxx - sx * sx;
        let fitted = if denom.abs() < 1e-12 {
            sy / sw
        } else {
            let b = (sw * sxy - sx * sy) / denom;
            let a = (sy - b * sx) / sw;
            a + b * center as f64
        };
        result.push(fitted);
    }
    result
}

// ─── Linear interpolation ──────────────────────────────────────────────────

/// Expand data by linear interpolation to add fps-1 intermediate points per second.
pub fn linear_interp(data: &[f64], fps: usize) -> Vec<f64> {
    let n = data.len();
    if n == 0 {
        return vec![];
    }
    // Append extrapolated boundary point
    let mut extended = data.to_vec();
    if n >= 2 {
        extended.push(2.0 * data[n - 1] - data[n - 2]);
    } else {
        extended.push(data[n - 1]);
    }

    let total = (n - 1) * fps + 1;
    let mut result = Vec::with_capacity(total);
    let step = 1.0 / fps as f64;
    let mut x = 0.0f64;

    while x <= (n - 1) as f64 + 1e-9 {
        let i = x.floor() as usize;
        let frac = x - i as f64;
        let i_next = (i + 1).min(extended.len() - 1);
        result.push(extended[i] + frac * (extended[i_next] - extended[i]));
        x += step;
    }
    result
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

pub fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6_371_000.0;
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let d_phi = (lat2 - lat1).to_radians();
    let d_lam = (lon2 - lon1).to_radians();
    let a = (d_phi / 2.0).sin().powi(2) + phi1.cos() * phi2.cos() * (d_lam / 2.0).sin().powi(2);
    R * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn time_delta_seconds(t1: Option<&str>, t2: Option<&str>) -> f64 {
    match (t1, t2) {
        (Some(a), Some(b)) => {
            use chrono::DateTime;
            let dt1 = DateTime::parse_from_rfc3339(a).ok();
            let dt2 = DateTime::parse_from_rfc3339(b).ok();
            match (dt1, dt2) {
                (Some(d1), Some(d2)) => (d2 - d1).num_milliseconds() as f64 / 1000.0,
                _ => 0.0,
            }
        }
        _ => 0.0,
    }
}

// ─── FIT helpers ──────────────────────────────────────────────────────────

/// FIT stores lat/lon as signed 32-bit semicircles; multiply by this to get degrees.
const SEMICIRCLES_TO_DEG: f64 = 180.0 / 2_147_483_648.0;

fn fit_f64(value: &fitparser::Value) -> Option<f64> {
    use fitparser::Value::*;
    match value {
        SInt8(v) => Some(*v as f64),
        UInt8(v) => Some(*v as f64),
        SInt16(v) => Some(*v as f64),
        UInt16(v) => Some(*v as f64),
        SInt32(v) => Some(*v as f64),
        UInt32(v) => Some(*v as f64),
        Float32(v) if v.is_finite() => Some(*v as f64),
        Float64(v) if v.is_finite() => Some(*v),
        SInt64(v) => Some(*v as f64),
        UInt64(v) => Some(*v as f64),
        _ => None,
    }
}

// ─── XML helpers ──────────────────────────────────────────────────────────

fn local_name(name: &[u8]) -> &str {
    let s = std::str::from_utf8(name).unwrap_or("");
    s.rfind(':').map(|i| &s[i + 1..]).unwrap_or(s)
}

fn attr_f64(e: &quick_xml::events::BytesStart, key: &[u8]) -> Option<f64> {
    e.attributes()
        .filter_map(|a| a.ok())
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| {
            std::str::from_utf8(a.value.as_ref())
                .ok()
                .and_then(|s| s.parse().ok())
        })
}
