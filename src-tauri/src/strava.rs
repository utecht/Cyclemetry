//! Strava OAuth + activity import.
//!
//! Flow: `strava_connect` opens the system browser at Strava's authorize page
//! with a `http://localhost:<port>/callback` redirect served by a one-shot
//! loopback listener (Strava's "Authorization Callback Domain" is `localhost`,
//! which permits any port). The code is exchanged for tokens which persist in
//! the app data dir; `strava_activities` lists rides a page at a time so we
//! stay far under Strava's rate limits, and `strava_import_activity` pulls the
//! activity's streams and materializes them as a GPX in the uploads dir, so an
//! imported ride behaves exactly like one opened from disk.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;

const CLIENT_ID: &str = "65000";
/// Baked in by build.rs from the STRAVA_CLIENT_SECRET env var (CI secret) or
/// src-tauri/.env (local dev). Empty when neither was set at compile time.
const CLIENT_SECRET: &str = env!("STRAVA_CLIENT_SECRET");
const PER_PAGE: u32 = 10;

fn ensure_secret() -> Result<(), String> {
    if CLIENT_SECRET.is_empty() {
        return Err("This build was compiled without a Strava client secret. \
             Add STRAVA_CLIENT_SECRET=… to src-tauri/.env and restart the dev app."
            .into());
    }
    Ok(())
}

// ─── Token persistence ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct StoredAuth {
    access_token: String,
    refresh_token: String,
    /// Unix seconds when `access_token` expires.
    expires_at: i64,
    /// Athlete display name, for the "connected as …" UI.
    athlete: Option<String>,
}

fn auth_file() -> PathBuf {
    crate::app_data_base().join("strava-auth.json")
}

fn load_auth() -> Option<StoredAuth> {
    let bytes = std::fs::read(auth_file()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_auth(auth: &StoredAuth) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(auth_file(), json).map_err(|e| format!("Failed to store Strava tokens: {e}"))
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Serialize)]
pub struct StravaStatus {
    connected: bool,
    athlete: Option<String>,
}

fn status_from_auth(auth: Option<&StoredAuth>) -> StravaStatus {
    StravaStatus {
        connected: auth.is_some(),
        athlete: auth.and_then(|a| a.athlete.clone()),
    }
}

#[tauri::command]
pub fn strava_status() -> StravaStatus {
    status_from_auth(load_auth().as_ref())
}

#[tauri::command]
pub fn strava_disconnect() -> Result<(), String> {
    // Best effort: revoke server-side so the app disappears from the user's
    // Strava "My Apps" list; local token removal is what actually matters.
    if let Some(auth) = load_auth() {
        tauri::async_runtime::spawn(async move {
            let _ = crate::http_client()
                .post("https://www.strava.com/oauth/deauthorize")
                .form(&[("access_token", auth.access_token)])
                .send()
                .await;
        });
    }
    std::fs::remove_file(auth_file()).ok();
    Ok(())
}

// ─── OAuth connect ────────────────────────────────────────────────────────────

/// Random hex string from std's per-instance-seeded hasher — enough entropy
/// for a loopback CSRF `state` token without pulling in a rand crate.
fn random_state() -> String {
    use std::hash::{BuildHasher, Hasher};
    let a = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    let b = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    format!("{a:016x}{b:016x}")
}

/// Extract a query parameter from a raw (still percent-encoded) query string.
/// `code`, `state`, and `error` are plain alphanumerics from Strava; `scope`
/// needs `percent_decode` before use.
fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then_some(v)
    })
}

/// Minimal %XX decoder for callback query values (e.g. scope
/// `read%2Cactivity%3Aread_all` → `read,activity:read_all`).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let decoded = (bytes[i] == b'%' && i + 2 < bytes.len())
            .then(|| u8::from_str_radix(&s[i + 1..i + 3], 16).ok())
            .flatten();
        match decoded {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Serve the loopback redirect: accept connections until the browser hits
/// `/callback`, answer with a small "you can close this tab" page, and return
/// the authorization code plus the scopes the user actually granted (Strava's
/// consent screen lets them uncheck permissions). Blocking; run inside
/// `spawn_blocking`.
fn wait_for_callback(
    listener: std::net::TcpListener,
    expected_state: &str,
) -> Result<(String, Option<String>), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() > deadline {
                    return Err("Timed out waiting for Strava authorization (5 min). \
                         Try connecting again."
                        .into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(format!("Callback listener failed: {e}")),
        };
        stream.set_nonblocking(false).ok();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .ok();
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        // Request line: "GET /callback?state=..&code=..&scope=.. HTTP/1.1"
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("");
        let Some(query) = path
            .strip_prefix("/callback?")
            .or_else(|| path.strip_prefix("/callback/?"))
        else {
            // Favicon or stray probe — 404 it and keep waiting.
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        };

        let respond = |stream: &mut std::net::TcpStream, body: &str| {
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            );
        };

        if query_param(query, "state") != Some(expected_state) {
            respond(&mut stream, PAGE_ERROR);
            return Err("Strava callback state mismatch — authorization aborted.".into());
        }
        if let Some(err) = query_param(query, "error") {
            respond(&mut stream, PAGE_ERROR);
            return Err(if err == "access_denied" {
                "Strava authorization was declined.".into()
            } else {
                format!("Strava authorization failed: {err}")
            });
        }
        let Some(code) = query_param(query, "code") else {
            respond(&mut stream, PAGE_ERROR);
            return Err("Strava callback missing authorization code.".into());
        };
        let scope = query_param(query, "scope").map(percent_decode);
        respond(&mut stream, PAGE_OK);
        return Ok((code.to_string(), scope));
    }
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Cyclemetry</title>\
<body style='background:#000;color:#FAFAFA;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0'>\
<div style='text-align:center'><p style='font-size:18px;font-weight:600'>Connected to Strava</p>\
<p style='color:#A7A7A7;font-size:14px'>You can close this tab and return to Cyclemetry.</p></div>";

const PAGE_ERROR: &str = "<!doctype html><meta charset=utf-8><title>Cyclemetry</title>\
<body style='background:#000;color:#FAFAFA;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0'>\
<div style='text-align:center'><p style='font-size:18px;font-weight:600'>Strava connection failed</p>\
<p style='color:#A7A7A7;font-size:14px'>Return to Cyclemetry and try again.</p></div>";

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    athlete: Option<serde_json::Value>,
}

fn athlete_name(athlete: Option<&serde_json::Value>) -> Option<String> {
    let a = athlete?;
    let first = a.get("firstname").and_then(|v| v.as_str()).unwrap_or("");
    let last = a.get("lastname").and_then(|v| v.as_str()).unwrap_or("");
    let name = format!("{first} {last}").trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[tauri::command]
pub async fn strava_connect() -> Result<StravaStatus, String> {
    ensure_secret()?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not open local callback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = random_state();

    let authorize_url = format!(
        "https://www.strava.com/oauth/authorize?client_id={CLIENT_ID}\
         &response_type=code\
         &redirect_uri=http%3A%2F%2Flocalhost%3A{port}%2Fcallback\
         &approval_prompt=auto\
         &scope=activity%3Aread_all\
         &state={state}"
    );
    crate::open_url(&authorize_url);

    let (code, granted_scope) =
        tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, &state))
            .await
            .map_err(|e| format!("Callback task failed: {e}"))??;

    // The consent screen lets the user uncheck the activity permission; a
    // token without it gets 403s on every activity endpoint, so fail loudly
    // now instead of at first listing.
    if let Some(scope) = &granted_scope
        && !scope.split(',').any(|s| s.starts_with("activity:read"))
    {
        return Err(format!(
            "Strava only granted \"{scope}\" — reconnect and keep the activity \
             permission boxes checked on the authorization page."
        ));
    }

    let resp = crate::http_client()
        .post("https://www.strava.com/oauth/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", &code),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Strava token exchange failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(api_error(resp, "token exchange").await);
    }
    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Strava token response malformed: {e}"))?;

    let auth = StoredAuth {
        athlete: athlete_name(token.athlete.as_ref()),
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
    };
    save_auth(&auth)?;
    Ok(status_from_auth(Some(&auth)))
}

/// Surface Strava's error body (truncated) instead of a bare status code —
/// Strava 403s carry a JSON body that names the exact missing permission.
async fn api_error(resp: reqwest::Response, what: &str) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if body.contains("activity:read_permission") {
        return "Strava didn't grant activity access — disconnect and reconnect, \
             keeping all permission boxes checked on the authorization page."
            .into();
    }
    // Strava deactivates API apps whose owner has no active Strava
    // subscription (Developer Program Standard Tier requirement).
    if body.contains("\"resource\":\"Application\"") && body.contains("\"code\":\"Inactive\"") {
        return "Cyclemetry's Strava API application is inactive on Strava's side — \
             the app owner's Strava subscription has lapsed. Strava import is \
             unavailable until it's reactivated; export a GPX from Strava and \
             load it from disk in the meantime."
            .into();
    }
    let snippet: String = body.chars().take(300).collect();
    format!("Strava {what} failed: HTTP {status} {snippet}")
}

/// Return a currently-valid access token, refreshing (and re-persisting) it
/// when within a minute of expiry.
async fn fresh_access_token() -> Result<String, String> {
    ensure_secret()?;
    let auth = load_auth().ok_or("Not connected to Strava.")?;
    if auth.expires_at > now_unix() + 60 {
        return Ok(auth.access_token);
    }
    let resp = crate::http_client()
        .post("https://www.strava.com/oauth/token")
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", &auth.refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Strava token refresh failed: {e}"))?;
    if !resp.status().is_success() {
        // Refresh token revoked (user removed the app on strava.com) —
        // drop local state so the UI falls back to "Connect".
        std::fs::remove_file(auth_file()).ok();
        return Err("Strava session expired — please reconnect.".into());
    }
    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Strava token response malformed: {e}"))?;
    let refreshed = StoredAuth {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token.expires_at,
        athlete: auth.athlete,
    };
    save_auth(&refreshed)?;
    Ok(refreshed.access_token)
}

// ─── Activity listing ─────────────────────────────────────────────────────────

/// Decode a Google encoded polyline into (lat, lon) pairs.
fn decode_polyline(encoded: &str) -> Vec<(f64, f64)> {
    let bytes = encoded.as_bytes();
    let mut points = Vec::new();
    let (mut i, mut lat, mut lon) = (0usize, 0i64, 0i64);
    let next_value = |i: &mut usize| -> Option<i64> {
        let (mut result, mut shift) = (0i64, 0u32);
        loop {
            let b = *bytes.get(*i)? as i64 - 63;
            *i += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        Some(if result & 1 != 0 {
            !(result >> 1)
        } else {
            result >> 1
        })
    };
    while i < bytes.len() {
        let Some(dlat) = next_value(&mut i) else {
            break;
        };
        let Some(dlon) = next_value(&mut i) else {
            break;
        };
        lat += dlat;
        lon += dlon;
        points.push((lat as f64 * 1e-5, lon as f64 * 1e-5));
    }
    points
}

#[derive(Deserialize)]
struct ApiActivity {
    id: i64,
    name: String,
    #[serde(default)]
    sport_type: Option<String>,
    /// ISO 8601 UTC, e.g. "2026-07-12T14:03:00Z".
    start_date: String,
    #[serde(default)]
    elapsed_time: Option<f64>,
    #[serde(default)]
    distance: Option<f64>,
    #[serde(default)]
    map: Option<ApiMap>,
}

#[derive(Deserialize)]
struct ApiMap {
    #[serde(default)]
    summary_polyline: Option<String>,
}

#[derive(Serialize)]
pub struct StravaActivityItem {
    id: i64,
    name: String,
    sport_type: Option<String>,
    /// Kept verbatim for `strava_import_activity` so import needs no extra
    /// detail request against the rate limit.
    start_date: String,
    start_ms: i64,
    duration_s: Option<f64>,
    distance_m: Option<f64>,
    /// Same unit-square preview format as `SavedActivity::track`.
    track: Vec<[f32; 2]>,
}

#[tauri::command]
pub async fn strava_activities(page: u32) -> Result<Vec<StravaActivityItem>, String> {
    let token = fresh_access_token().await?;
    let url = format!(
        "https://www.strava.com/api/v3/athlete/activities?page={}&per_page={PER_PAGE}",
        page.max(1)
    );
    let resp = crate::http_client()
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Strava: {e}"))?;
    match resp.status().as_u16() {
        401 => {
            std::fs::remove_file(auth_file()).ok();
            return Err("Strava session expired — please reconnect.".into());
        }
        429 => return Err("Strava rate limit reached — wait a few minutes and try again.".into()),
        s if s >= 400 => return Err(api_error(resp, "activity listing").await),
        _ => {}
    }
    let activities: Vec<ApiActivity> = resp
        .json()
        .await
        .map_err(|e| format!("Strava activities response malformed: {e}"))?;

    Ok(activities
        .into_iter()
        .map(|a| {
            let course = a
                .map
                .as_ref()
                .and_then(|m| m.summary_polyline.as_deref())
                .map(decode_polyline)
                .unwrap_or_default();
            let start_ms = chrono::DateTime::parse_from_rfc3339(&a.start_date)
                .map(|t| t.timestamp_millis())
                .unwrap_or(0);
            StravaActivityItem {
                track: crate::preview_track(&course),
                id: a.id,
                name: a.name,
                sport_type: a.sport_type,
                start_date: a.start_date,
                start_ms,
                duration_s: a.elapsed_time.filter(|d| d.is_finite() && *d > 0.0),
                distance_m: a.distance.filter(|d| d.is_finite() && *d > 0.0),
            }
        })
        .collect())
}

// ─── Import: streams → GPX in uploads dir ─────────────────────────────────────

/// Sensor streams use `Option<f64>` elements because Strava emits `null`
/// for gaps (power while coasting, sensor dropouts); a strict `f64` would
/// fail the whole deserialization on the first gap.
#[derive(Deserialize, Default)]
struct StreamSet {
    #[serde(default)]
    time: Option<Stream<Option<f64>>>,
    #[serde(default)]
    latlng: Option<Stream<Option<[f64; 2]>>>,
    #[serde(default)]
    altitude: Option<Stream<Option<f64>>>,
    #[serde(default)]
    heartrate: Option<Stream<Option<f64>>>,
    #[serde(default)]
    cadence: Option<Stream<Option<f64>>>,
    #[serde(default)]
    watts: Option<Stream<Option<f64>>>,
    #[serde(default)]
    temp: Option<Stream<Option<f64>>>,
    #[serde(default)]
    velocity_smooth: Option<Stream<Option<f64>>>,
}

#[derive(Deserialize)]
struct Stream<T> {
    data: Vec<T>,
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    let mut out: String = trimmed.chars().take(80).collect();
    if out.is_empty() {
        out = "strava-activity".into();
    }
    out
}

/// Download an activity's streams and write them as a GPX into the uploads
/// dir. Returns the saved filename; the frontend then loads it through the
/// normal saved-activity path.
#[tauri::command]
pub async fn strava_import_activity(
    id: i64,
    name: String,
    start_date: String,
) -> Result<String, String> {
    use chrono::{DateTime, SecondsFormat, TimeDelta, Utc};

    let token = fresh_access_token().await?;
    let url = format!(
        "https://www.strava.com/api/v3/activities/{id}/streams\
         ?keys=time,latlng,altitude,heartrate,cadence,watts,temp,velocity_smooth&key_by_type=true"
    );
    let resp = crate::http_client()
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Could not reach Strava: {e}"))?;
    match resp.status().as_u16() {
        401 => {
            std::fs::remove_file(auth_file()).ok();
            return Err("Strava session expired — please reconnect.".into());
        }
        404 => {
            return Err(
                "This activity has no GPS data to import (manual or trainer activity).".into(),
            );
        }
        429 => return Err("Strava rate limit reached — wait a few minutes and try again.".into()),
        s if s >= 400 => return Err(api_error(resp, "stream download").await),
        _ => {}
    }
    let streams: StreamSet = resp
        .json()
        .await
        .map_err(|e| format!("Strava streams response malformed: {e}"))?;

    let latlng = streams
        .latlng
        .ok_or("This activity has no GPS track — nothing to import.")?
        .data;
    if latlng.iter().flatten().count() < 2 {
        return Err("This activity's GPS track is too short to import.".into());
    }
    let get = |s: &Option<Stream<Option<f64>>>, i: usize| -> Option<f64> {
        s.as_ref().and_then(|s| s.data.get(i).copied().flatten())
    };

    let start: DateTime<Utc> = DateTime::parse_from_rfc3339(&start_date)
        .map_err(|e| format!("Bad activity start time from Strava: {e}"))?
        .with_timezone(&Utc);

    let mut gpx = String::with_capacity(latlng.len() * 160);
    gpx.push_str(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <gpx version=\"1.1\" creator=\"Cyclemetry (Strava import)\" \
         xmlns=\"http://www.topografix.com/GPX/1/1\" \
         xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\">\n",
    );
    gpx.push_str(&format!(
        "<metadata><time>{}</time></metadata>\n<trk><name>{}</name>",
        start.to_rfc3339_opts(SecondsFormat::Secs, true),
        xml_escape(&name),
    ));
    gpx.push_str("<trkseg>\n");

    for (i, pos) in latlng.iter().enumerate() {
        let Some([lat, lon]) = pos else { continue };
        gpx.push_str(&format!("<trkpt lat=\"{lat}\" lon=\"{lon}\">"));
        if let Some(ele) = get(&streams.altitude, i) {
            gpx.push_str(&format!("<ele>{ele}</ele>"));
        }
        let offset_s = get(&streams.time, i).unwrap_or(i as f64);
        let t = start + TimeDelta::milliseconds((offset_s * 1000.0) as i64);
        gpx.push_str(&format!(
            "<time>{}</time>",
            t.to_rfc3339_opts(SecondsFormat::Secs, true)
        ));

        let hr = get(&streams.heartrate, i);
        let cad = get(&streams.cadence, i);
        let at = get(&streams.temp, i);
        let spd = get(&streams.velocity_smooth, i);
        let w = get(&streams.watts, i);
        if hr.is_some() || cad.is_some() || at.is_some() || spd.is_some() || w.is_some() {
            gpx.push_str("<extensions>");
            if let Some(w) = w {
                gpx.push_str(&format!("<power>{}</power>", w.round() as i64));
            }
            gpx.push_str("<gpxtpx:TrackPointExtension>");
            if let Some(hr) = hr {
                gpx.push_str(&format!("<gpxtpx:hr>{}</gpxtpx:hr>", hr.round() as i64));
            }
            if let Some(cad) = cad {
                gpx.push_str(&format!("<gpxtpx:cad>{}</gpxtpx:cad>", cad.round() as i64));
            }
            if let Some(at) = at {
                gpx.push_str(&format!("<gpxtpx:atemp>{at}</gpxtpx:atemp>"));
            }
            if let Some(spd) = spd {
                gpx.push_str(&format!("<gpxtpx:speed>{spd}</gpxtpx:speed>"));
            }
            gpx.push_str("</gpxtpx:TrackPointExtension></extensions>");
        }
        gpx.push_str("</trkpt>\n");
    }
    gpx.push_str("</trkseg></trk></gpx>\n");

    let filename = format!("{}.gpx", sanitize_filename(&name));
    let dest = crate::uploads_dir().join(&filename);
    std::fs::write(&dest, gpx).map_err(|e| format!("Failed to save imported activity: {e}"))?;
    Ok(filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_google_reference_polyline() {
        let pts = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
        assert_eq!(pts.len(), 3);
        let expect = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)];
        for ((lat, lon), (elat, elon)) in pts.iter().zip(expect) {
            assert!((lat - elat).abs() < 1e-9, "lat {lat} != {elat}");
            assert!((lon - elon).abs() < 1e-9, "lon {lon} != {elon}");
        }
    }

    #[test]
    fn percent_decode_scope_values() {
        assert_eq!(
            percent_decode("read%2Cactivity%3Aread_all"),
            "read,activity:read_all"
        );
        assert_eq!(
            percent_decode("read,activity:read_all"),
            "read,activity:read_all"
        );
        assert_eq!(percent_decode("a%2"), "a%2"); // truncated escape passes through
    }

    #[test]
    fn decode_polyline_tolerates_truncated_input() {
        // Must not panic or loop forever on garbage/truncated data.
        assert!(decode_polyline("").is_empty());
        decode_polyline("_p~iF");
        decode_polyline("\u{7f}");
    }
}
