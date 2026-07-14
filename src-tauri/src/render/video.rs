use serde::Serialize;
use std::process::Stdio;

use crate::render::scene::{ffmpeg_command, resolve_ffmpeg};

#[derive(Serialize)]
pub struct VideoProbe {
    pub path: String,
    pub duration: Option<f64>,
    pub creation_time: Option<String>,
    /// Set when `creation_time` was corrected from sibling files (e.g. GoPro
    /// chapter files all carry chapter 1's timestamp). Surfaced in the UI so
    /// wall-clock alignment is never silently based on rewritten metadata.
    pub creation_time_note: Option<String>,
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
    let mut probe = probe_raw(path)?;
    adjust_gopro_chapter_time(&mut probe);
    Ok(probe)
}

fn probe_raw(path: &str) -> Result<VideoProbe, String> {
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
        creation_time_note: None,
        codec,
        width,
        height,
    })
}

/// GoPro splits long recordings into ~4 GiB chapter files (`GX01aaaa.MP4`,
/// `GX02aaaa.MP4`, …) and stamps **every** chapter with the wall-clock time
/// recording started — i.e. chapter 1's start, not the chapter's own. Aligning
/// chapter 2+ by its container `creation_time` therefore lands hours/minutes
/// early. When the earlier chapters sit next to the probed file, shift
/// `creation_time` forward by their summed durations; if any earlier chapter is
/// missing or unreadable, leave the timestamp untouched rather than guess.
fn adjust_gopro_chapter_time(probe: &mut VideoProbe) {
    use chrono::{DateTime, Duration, SecondsFormat};

    let Some(ct) = probe.creation_time.as_deref() else {
        return;
    };
    let path = std::path::Path::new(&probe.path);
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    // HERO6+ naming: G[XH]ccnnnn.MP4 — GX=HEVC, GH=AVC; cc = 01-based chapter
    // number, nnnn = recording id shared by all chapters.
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return;
    };
    if !ext.eq_ignore_ascii_case("mp4") || stem.len() != 8 {
        return;
    }
    let prefix = &stem[..2];
    if !prefix.eq_ignore_ascii_case("GX") && !prefix.eq_ignore_ascii_case("GH") {
        return;
    }
    let Ok(chapter) = stem[2..4].parse::<u32>() else {
        return;
    };
    let recording_id = &stem[4..];
    if chapter < 2 || !recording_id.bytes().all(|b| b.is_ascii_digit()) {
        return;
    }
    let Ok(start) = DateTime::parse_from_rfc3339(ct) else {
        return;
    };
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));

    let mut earlier_secs = 0.0;
    for c in 1..chapter {
        let sibling = dir.join(format!("{prefix}{c:02}{recording_id}.{ext}"));
        let Ok(sibling_probe) = probe_raw(&sibling.to_string_lossy()) else {
            return;
        };
        let Some(d) = sibling_probe.duration else {
            return;
        };
        earlier_secs += d;
    }

    let adjusted = start + Duration::milliseconds((earlier_secs * 1000.0).round() as i64);
    probe.creation_time = Some(adjusted.to_rfc3339_opts(SecondsFormat::Millis, true));
    probe.creation_time_note = Some(format!(
        "GoPro chapter {chapter}: recording start computed from chapter 1's timestamp + {} of earlier chapters",
        format_secs(earlier_secs),
    ));
}

fn format_secs(secs: f64) -> String {
    let total = secs.round() as i64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}h {m}m {s}s")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
    }
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

    fn probe_named(name: &str) -> VideoProbe {
        VideoProbe {
            path: format!("/nonexistent-test-dir/{name}"),
            duration: Some(600.0),
            creation_time: Some("2026-07-11T20:39:31.000000Z".to_string()),
            creation_time_note: None,
            codec: Some("hevc".to_string()),
            width: 3840,
            height: 2160,
        }
    }

    #[test]
    fn gopro_chapter_missing_sibling_leaves_creation_time_untouched() {
        // Chapter 2 naming, but chapter 1 doesn't exist on disk — must not guess.
        let mut p = probe_named("GX020114.MP4");
        adjust_gopro_chapter_time(&mut p);
        assert_eq!(
            p.creation_time.as_deref(),
            Some("2026-07-11T20:39:31.000000Z")
        );
        assert!(p.creation_time_note.is_none());
    }

    #[test]
    fn non_chapter_names_are_not_adjusted() {
        // Chapter 1, non-GoPro names, and non-mp4 extensions never probe siblings
        // (which would fail here) and never rewrite the timestamp.
        for name in [
            "GX010114.MP4",
            "epoday245.mov",
            "IMG_1234.MP4",
            "GXAB0114.MP4",
        ] {
            let mut p = probe_named(name);
            adjust_gopro_chapter_time(&mut p);
            assert_eq!(
                p.creation_time.as_deref(),
                Some("2026-07-11T20:39:31.000000Z"),
                "{name}"
            );
            assert!(p.creation_time_note.is_none(), "{name}");
        }
    }

    #[test]
    fn formats_seconds_human_readable() {
        assert_eq!(format_secs(42.4), "42s");
        assert_eq!(format_secs(2114.11), "35m 14s");
        assert_eq!(format_secs(7325.0), "2h 2m 5s");
    }

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
