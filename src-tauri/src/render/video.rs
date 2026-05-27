use serde::Serialize;
use std::process::Stdio;

use crate::render::scene::{ffmpeg_command, resolve_ffmpeg};

#[derive(Serialize)]
pub struct VideoProbe {
    pub path: String,
    pub duration: Option<f64>,
    pub creation_time: Option<String>,
    pub codec: Option<String>,
    pub width: u32,
    pub height: u32,
}

/// Shell out to bundled ffmpeg with `-i` and parse the metadata it writes to
/// stderr. We don't ship ffprobe separately — ffmpeg's stderr banner has every
/// field we need (duration, creation_time, video codec, resolution).
///
/// Returns Err if ffmpeg can't be spawned or the file can't be read; returns Ok
/// with `duration = None` if ffmpeg ran but the container had no Duration line
/// (rare, but possible for some streamed formats).
pub fn probe(path: &str) -> Result<VideoProbe, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("Video file not found: {path}"));
    }
    let ffmpeg_bin = resolve_ffmpeg();
    let mut cmd = ffmpeg_command(&ffmpeg_bin);
    // `-i` alone exits non-zero ("at least one output must be specified"); the
    // banner we want is on stderr regardless. `-t 0 -f null -` keeps the exit
    // code 0 and skips any decoding work.
    cmd.args(["-hide_banner", "-i", path, "-t", "0", "-f", "null", "-"]);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to spawn ffmpeg ({ffmpeg_bin}): {e}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_ffmpeg_metadata(path, &stderr)
}

fn parse_ffmpeg_metadata(path: &str, stderr: &str) -> Result<VideoProbe, String> {
    let mut duration: Option<f64> = None;
    let mut creation_time: Option<String> = None;
    let mut codec: Option<String> = None;
    let mut width: u32 = 0;
    let mut height: u32 = 0;

    for raw in stderr.lines() {
        let line = raw.trim_start();

        if let Some(rest) = line.strip_prefix("Duration:") {
            // "Duration: 00:15:42.50, start: 0.000000, bitrate: ..."
            let rest = rest.trim_start();
            let dur_str = rest.split(',').next().unwrap_or("").trim();
            if dur_str != "N/A" {
                duration = parse_hms(dur_str);
            }
        }

        // creation_time appears in the container metadata block and again per
        // stream — take the first (container) value.
        if creation_time.is_none()
            && line.starts_with("creation_time")
            && let Some(colon) = line.find(':')
        {
            let val = line[colon + 1..].trim();
            if !val.is_empty() {
                creation_time = Some(val.to_string());
            }
        }

        // First video stream wins. Lines look like:
        //   Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x...), yuv420p..., 3840x2160 [SAR ...], 30 fps, ...
        if codec.is_none()
            && let Some(idx) = line.find(": Video: ")
        {
            let rest = &line[idx + ": Video: ".len()..];
            let name: String = rest
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != ',')
                .collect();
            if !name.is_empty() {
                codec = Some(name);
            }
            if let Some((w, h)) = find_resolution(rest) {
                width = w;
                height = h;
            }
        }
    }

    if codec.is_none() && width == 0 {
        return Err(format!(
            "ffmpeg could not read video metadata from {path} — file may be corrupt or use an unsupported container"
        ));
    }

    Ok(VideoProbe {
        path: path.to_string(),
        duration,
        creation_time,
        codec,
        width,
        height,
    })
}

fn parse_hms(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// Scan for the first `WxH` pair where both sides are ≥3 digits (filters out
/// `SAR 1:1`, `DAR 16:9`, and bit-depth notations like `10x` in profile names).
fn find_resolution(s: &str) -> Option<(u32, u32)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'x' && i > 0 && i + 1 < bytes.len() {
            let mut j = i;
            while j > 0 && bytes[j - 1].is_ascii_digit() {
                j -= 1;
            }
            let mut k = i + 1;
            while k < bytes.len() && bytes[k].is_ascii_digit() {
                k += 1;
            }
            let w_len = i - j;
            let h_len = k - (i + 1);
            if w_len >= 3
                && h_len >= 3
                && let (Ok(w), Ok(h)) = (s[j..i].parse::<u32>(), s[i + 1..k].parse::<u32>())
                && w >= 100
                && h >= 100
            {
                return Some((w, h));
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_HEVC: &str = "\
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/clip.mp4':
  Metadata:
    major_brand     : mp42
    creation_time   : 2024-08-15T14:23:01.000000Z
  Duration: 00:15:42.50, start: 0.000000, bitrate: 12345 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 3840x2160 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 600 tbn (default)
    Metadata:
      creation_time   : 2024-08-15T14:23:01.000000Z
      handler_name    : Core Media Video
";

    #[test]
    fn parses_hevc_metadata() {
        let probe = parse_ffmpeg_metadata("/tmp/clip.mp4", SAMPLE_HEVC).unwrap();
        assert_eq!(probe.path, "/tmp/clip.mp4");
        assert_eq!(probe.duration, Some(942.5));
        assert_eq!(
            probe.creation_time.as_deref(),
            Some("2024-08-15T14:23:01.000000Z")
        );
        assert_eq!(probe.codec.as_deref(), Some("hevc"));
        assert_eq!(probe.width, 3840);
        assert_eq!(probe.height, 2160);
    }

    #[test]
    fn skips_sar_dar_for_resolution() {
        let line = ": Video: h264 ..., 1920x1080 [SAR 1:1 DAR 16:9], 30 fps";
        assert_eq!(find_resolution(line), Some((1920, 1080)));
    }

    #[test]
    fn handles_missing_duration() {
        let no_duration = "Input #0, ...:\n  Stream #0:0: Video: h264, 640x480, 30 fps\n";
        let probe = parse_ffmpeg_metadata("/x", no_duration).unwrap();
        assert_eq!(probe.duration, None);
        assert_eq!(probe.codec.as_deref(), Some("h264"));
        assert_eq!(probe.width, 640);
    }
}
