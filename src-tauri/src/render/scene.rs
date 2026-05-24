/// Scene orchestration: builds caches, drives the frame loop, pipes to FFmpeg.
///
/// Optimization layout:
///   - One-time: parse GPX, interpolate, smooth, build chart/font caches, pre-render base frame
///   - Per-frame: blit base + chart marker + dynamic text → pipe raw RGBA to FFmpeg stdin
///   - Frame loop: producer thread renders rayon parallel chunks and sends frames through a
///     bounded channel; consumer (main thread) drains to FFmpeg stdin concurrently so render
///     and encode overlap instead of running back-to-back.
use rayon::prelude::*;
use std::collections::HashSet;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use crate::render::activity::Activity;
use crate::render::frame::{SceneCache, render_frame};
use crate::render::template::Template;

pub struct RenderProgress {
    pub frames_rendered: Arc<AtomicU64>,
    pub total_frames: Arc<AtomicU64>,
    pub cancelled: Arc<AtomicBool>,
}

impl RenderProgress {
    pub fn new() -> Self {
        RenderProgress {
            frames_rendered: Arc::new(AtomicU64::new(0)),
            total_frames: Arc::new(AtomicU64::new(0)),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self) -> (u64, u64) {
        (
            self.frames_rendered.load(Ordering::Relaxed),
            self.total_frames.load(Ordering::Relaxed),
        )
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

/// Full video render pipeline.
pub fn render_video(
    gpx_path: &str,
    template: &Template,
    output_path: &str,
    fonts_dir: &str,
    assets_dirs: &[&str],
    progress: &RenderProgress,
) -> Result<(), String> {
    log::info!(
        "render_video: start gpx={gpx_path}, output={output_path}, assets_dirs={assets_dirs:?}"
    );

    // --- Load and prepare activity data ---
    log::info!("render_video: loading activity");
    let activity = Activity::from_file(gpx_path)?;
    if progress.cancelled.load(Ordering::Relaxed) {
        return Err("Render cancelled".to_string());
    }
    log::info!(
        "render_video: activity loaded ({} samples)",
        activity.data_len()
    );
    let activity = activity.sample_for_scene(&template.scene, false)?;
    if progress.cancelled.load(Ordering::Relaxed) {
        return Err("Render cancelled".to_string());
    }
    log::info!(
        "render_video: activity prepared at {}fps ({} frames)",
        template.scene.fps,
        activity.data_len()
    );

    let total_frames = activity.data_len();
    progress
        .total_frames
        .store(total_frames as u64, Ordering::Relaxed);

    // --- Build caches ---
    log::info!("render_video: building scene cache");
    let cache = SceneCache::build(&activity, template, fonts_dir, assets_dirs)
        .map_err(|e| format!("Cache build failed: {e}"))?;
    if progress.cancelled.load(Ordering::Relaxed) {
        return Err("Render cancelled".to_string());
    }
    log::info!("render_video: scene cache built");

    // --- Crop to the union of all visible elements ---
    // The overlay is mostly transparent; rasterising + piping + encoding the
    // full 4K frame is overhead. compute_crop_rect returns None when cropping
    // wouldn't pay off, in which case we keep the full-frame path.
    log::info!("render_video: computing crop rect");
    let crop = crate::render::frame::compute_crop_rect(
        &activity,
        template,
        fonts_dir,
        Some(&progress.cancelled),
    );
    if progress.cancelled.load(Ordering::Relaxed) {
        return Err("Render cancelled".to_string());
    }
    log::info!("render_video: crop rect computed");
    let (w, h) = match &crop {
        Some(c) => {
            log::info!(
                "render_video: cropping to {}x{} at offset ({},{}) — {:.0}% of {}x{} frame",
                c.w,
                c.h,
                c.x,
                c.y,
                100.0 * (c.w as f32 * c.h as f32) / (cache.width as f32 * cache.height as f32),
                cache.width,
                cache.height
            );
            (c.w, c.h)
        }
        // Ensure even dimensions (codec requirement)
        None => ((cache.width + 1) & !1, (cache.height + 1) & !1),
    };

    // Snapshot the full canvas before `cache` is moved into the producer
    // closure; needed for the placement sidecar after the render scope.
    let (full_w, full_h) = (cache.width, cache.height);

    // --- Spawn FFmpeg ---
    let ffmpeg_bin = resolve_ffmpeg();
    let encoder = select_ffmpeg_encoder(&ffmpeg_bin)?;
    log::info!(
        "render_video: spawning FFmpeg from {ffmpeg_bin} with {} ({})",
        encoder.codec,
        encoder.mode
    );
    let mut cmd = ffmpeg_command(&ffmpeg_bin);
    cmd.args([
        "-loglevel",
        "warning",
        "-f",
        "rawvideo",
        // Skia renders BGRA8888 natively; feeding bgra means FFmpeg does
        // zero per-frame swscale conversion before the encoder.
        "-pix_fmt",
        "bgra",
        "-s",
        &format!("{w}x{h}"),
        "-r",
        &template.scene.fps.to_string(),
        "-i",
        "-",
        "-c:v",
        &encoder.codec,
        "-profile:v",
        "4444",
        "-y",
        output_path,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    let mut ffmpeg = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg ({ffmpeg_bin}): {e}"))?;

    let mut stdin = ffmpeg.stdin.take().unwrap();
    log::info!("render_video: FFmpeg spawned (PID {})", ffmpeg.id());

    // Drain stderr in a background thread to prevent pipe-buffer deadlock during
    // finalization: FFmpeg flushes encoder + writes moov atom and may emit >65 KB
    // of progress/stats to stderr. If we only read it after ffmpeg.wait(), the pipe
    // fills, FFmpeg blocks, and wait() deadlocks.
    // Log each stderr line as it arrives so finalization issues are visible in real time.
    // Collecting into Vec<String> lets us surface the last lines on failure.
    let stderr_drainer = ffmpeg.stderr.take().map(|stderr| {
        std::thread::spawn(move || -> Vec<String> {
            use std::io::BufRead;
            let mut lines = Vec::new();
            for line in std::io::BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
            {
                log::warn!("ffmpeg: {line}");
                lines.push(line);
            }
            lines
        })
    });

    // --- Pipelined frame loop ---
    // Layout: producer renders rayon chunks → bounded channel → consumer writes to FFmpeg stdin.
    // Consumer runs in its own thread so the main scope thread can act as a cancel watchdog:
    // when cancelled, the watchdog kills FFmpeg, which breaks the stdin pipe and causes the
    // consumer's write_all to return EPIPE immediately — no more stuck write_all on disk I/O.
    let num_threads = rayon::current_num_threads();
    let chunk_size = (num_threads * 2).max(8);
    log::info!(
        "render_video: {total_frames} frames, {num_threads} rayon threads, chunk_size={chunk_size}"
    );

    let pipeline_start = Instant::now();

    // thread::scope guarantees all spawned threads finish before the scope exits,
    // allowing safe borrows of `cache`, `activity`, `template`, and `progress`.
    let scope_result: Result<(Duration, Duration), String> = std::thread::scope(|s| {
        // tx/rx are created INSIDE the scope so the producer can take ownership of tx.
        // With `move ||`, when producer exits it drops tx, which disconnects the channel
        // and lets consumer's rx.recv() return Err — without this, tx would live in the
        // outer function and rx.recv() would block forever after all frames are queued.
        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(chunk_size);

        let cancelled = &progress.cancelled;

        let producer = s.spawn(move || -> (bool, Duration) {
            let mut sent = 0usize;
            let mut total_render = Duration::ZERO;
            while sent < total_frames {
                if cancelled.load(Ordering::Relaxed) {
                    return (true, total_render);
                }
                let chunk_end = (sent + chunk_size).min(total_frames);
                let t0 = Instant::now();
                let frames: Vec<Vec<u8>> = (sent..chunk_end)
                    .into_par_iter()
                    .map(|i| render_frame(i, &cache, &activity, template, crop.as_ref()))
                    .collect();
                let render_elapsed = t0.elapsed();
                total_render += render_elapsed;
                log::debug!(
                    "chunk {sent}..{chunk_end}: render={:.0}ms",
                    render_elapsed.as_secs_f64() * 1000.0,
                );
                for frame in frames {
                    if tx.send(frame).is_err() {
                        return (false, total_render); // consumer stopped (error or cancel)
                    }
                    sent += 1;
                }
            }
            (false, total_render)
        });

        // Consumer thread: drain frames from the channel and write to FFmpeg stdin.
        // stdin is moved in so the pipe closes (EOF) when this thread exits.
        //
        // Blocking write_all: the kernel wakes the writer the instant pipe
        // space frees, so feed throughput tracks FFmpeg's encode rate exactly.
        // (The previous O_NONBLOCK + 1ms-sleep poll fed at best one pipe buffer
        // per scheduler quantum — an order-of-magnitude throughput tax that
        // dominated wall time once the frames themselves were cheap.)
        // Cancellation stays prompt: the watchdog below kills FFmpeg on cancel,
        // which breaks the pipe so write_all returns EPIPE immediately; we also
        // check the cancel flag once per frame (≤ one frame of latency).
        let cancelled_consumer = Arc::clone(&progress.cancelled);
        let frames_counter = Arc::clone(&progress.frames_rendered);
        let consumer = s.spawn(move || -> (Option<String>, Duration) {
            use std::io::Write as _;

            let drain_start = Instant::now();
            let mut frame_idx = 0usize;
            let mut consumer_err: Option<String> = None;
            let mut last_write_log = Instant::now();

            while let Ok(data) = rx.recv() {
                if cancelled_consumer.load(Ordering::Relaxed) {
                    break;
                }
                if last_write_log.elapsed() >= Duration::from_secs(5) {
                    log::info!(
                        "consumer: writing frame {frame_idx}/{total_frames} \
                         ({:.0}s elapsed)",
                        drain_start.elapsed().as_secs_f64()
                    );
                    last_write_log = Instant::now();
                }
                if let Err(e) = stdin.write_all(&data) {
                    // EPIPE = FFmpeg exited (cancel watchdog kill, or an encode
                    // error surfaced via stderr); silent for the cancel case.
                    let msg = e.to_string();
                    if !msg.contains("Broken pipe") && !msg.contains("os error 32") {
                        consumer_err = Some(format!("FFmpeg pipe error at frame {frame_idx}: {e}"));
                    }
                    break;
                }
                frame_idx += 1;
                frames_counter.store(frame_idx as u64, Ordering::Relaxed);
            }
            let total_drain = drain_start.elapsed();
            log::info!(
                "consumer: done — {frame_idx} frames in {:.1}s",
                total_drain.as_secs_f64()
            );
            (consumer_err, total_drain)
        });

        // Cancel watchdog: poll the cancel flag every 10ms.
        // When cancelled, kill FFmpeg — this breaks the stdin pipe so the consumer's
        // write_all returns EPIPE immediately instead of blocking until disk I/O drains.
        loop {
            if cancelled.load(Ordering::Relaxed) {
                log::info!("render_video: cancel detected in watchdog — killing FFmpeg");
                let _ = ffmpeg.kill();
                break;
            }
            if consumer.is_finished() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        let (consumer_err, total_drain) = consumer.join().expect("render consumer panicked");
        let (was_cancelled, total_render) = producer.join().expect("render producer panicked");

        if let Some(e) = consumer_err {
            return Err(e);
        }
        if was_cancelled || cancelled.load(Ordering::Relaxed) {
            return Err("Render cancelled".to_string());
        }
        Ok((total_render, total_drain))
    });

    log::info!("render_video: scope exited — stdin EOF sent, awaiting FFmpeg");

    let (total_render_time, total_drain_time) = match scope_result {
        Ok(t) => t,
        Err(e) => {
            let _ = ffmpeg.kill();
            let _ = ffmpeg.wait();
            // Collect FFmpeg stderr now — it explains why the scope failed (e.g. startup crash).
            let stderr_lines = stderr_drainer
                .and_then(|t| t.join().ok())
                .unwrap_or_default();
            if std::path::Path::new(output_path).exists() {
                let _ = std::fs::remove_file(output_path);
            }
            return if stderr_lines.is_empty() {
                Err(e)
            } else {
                Err(format!("{e}\nFFmpeg: {}", stderr_lines.join("\n")))
            };
        }
    };

    let total_elapsed = pipeline_start.elapsed();
    let fps_actual = total_frames as f64 / total_elapsed.as_secs_f64();
    log::info!(
        "render_video done: {total_frames} frames in {:.1}s @ {fps_actual:.1} fps  \
         | render {:.1}s ({:.1}ms/frame)  \
         | drain(encode) {:.1}s ({:.1}ms/frame)  \
         | overlap savings {:.1}s",
        total_elapsed.as_secs_f64(),
        total_render_time.as_secs_f64(),
        total_render_time.as_secs_f64() * 1000.0 / total_frames as f64,
        total_drain_time.as_secs_f64(),
        total_drain_time.as_secs_f64() * 1000.0 / total_frames as f64,
        (total_render_time + total_drain_time)
            .saturating_sub(total_elapsed)
            .as_secs_f64(),
    );

    // Poll FFmpeg exit while respecting mid-finalization cancel requests.
    // ffmpeg.wait() would block until FFmpeg exits with no cancel escape hatch;
    // try_wait() lets us interleave a cancel check every 50 ms.
    let finalize_start = Instant::now();
    log::info!("render_video: finalization started (FFmpeg mux/write)");
    let mut last_heartbeat = Instant::now();
    let status = loop {
        if progress.cancelled.load(Ordering::Relaxed) {
            log::info!("render_video: cancelled during finalization — killing FFmpeg");
            let _ = ffmpeg.kill();
            let _ = ffmpeg.wait();
            let _ = stderr_drainer.map(|t| t.join());
            if std::path::Path::new(output_path).exists() {
                let _ = std::fs::remove_file(output_path);
            }
            return Err("Render cancelled".to_string());
        }
        if last_heartbeat.elapsed() >= Duration::from_secs(5) {
            log::info!(
                "render_video: still finalizing… {:.1}s elapsed",
                finalize_start.elapsed().as_secs_f64()
            );
            last_heartbeat = Instant::now();
        }
        match ffmpeg
            .try_wait()
            .map_err(|e| format!("FFmpeg wait error: {e}"))?
        {
            Some(status) => break status,
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    };
    log::info!(
        "render_video: finalization done in {:.1}s",
        finalize_start.elapsed().as_secs_f64()
    );

    let ffmpeg_stderr_lines = stderr_drainer
        .and_then(|t| t.join().ok())
        .unwrap_or_default();

    if !status.success() {
        let ffmpeg_stderr = ffmpeg_stderr_lines.join("\n");
        if std::path::Path::new(output_path).exists() {
            let _ = std::fs::remove_file(output_path);
        }
        return Err(if ffmpeg_stderr.is_empty() {
            format!("FFmpeg failed ({})", status)
        } else {
            format!("FFmpeg failed ({}): {ffmpeg_stderr}", status)
        });
    }

    let frames_written = progress.frames_rendered.load(Ordering::Relaxed);
    if frames_written == 0 {
        if std::path::Path::new(output_path).exists() {
            let _ = std::fs::remove_file(output_path);
        }
        return Err(format!(
            "Render produced no output ({total_frames} frames expected). \
             FFmpeg may be missing — install it via Homebrew: brew install ffmpeg"
        ));
    }

    // Cropped output is smaller than the footage canvas — record exactly where
    // it must be positioned so it isn't guessed-at in the editor later.
    if let Some(c) = crop {
        write_placement_sidecar(output_path, c, full_w, full_h);
    }

    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Write a human-readable placement file next to the cropped `.mov`. The crop
/// trims the transparent margin, so the video is smaller than the footage
/// canvas and must be offset when composited. The file travels with the video
/// (it's keyed off the output path) so the offset is available whenever the
/// editor project is opened.
fn write_placement_sidecar(
    output_path: &str,
    crop: crate::render::frame::CropRect,
    full_w: u32,
    full_h: u32,
) {
    let (x, y, w, h) = (crop.x, crop.y, crop.w as i32, crop.h as i32);
    // Final Cut "Transform → Position" is measured from the project centre,
    // +X right and +Y up. Screen Y grows downward, hence the inversion.
    let fcp_x = (x + w / 2) - (full_w as i32 / 2);
    let fcp_y = (full_h as i32 / 2) - (y + h / 2);

    let name = std::path::Path::new(output_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let body = format!(
        "Cyclemetry overlay placement\n\
         ============================\n\
         Overlay video : {name}\n\
         Overlay size  : {w} x {h} px\n\
         Full canvas   : {full_w} x {full_h} px  (match your footage resolution)\n\
         \n\
         The overlay was cropped to the region that actually contains pixels,\n\
         so it is smaller than the canvas. Position it over your footage as:\n\
         \n\
         Top-left placement (unambiguous):\n\
         \tx = {x} px , y = {y} px   from the top-left of the {full_w} x {full_h} canvas\n\
         \n\
         Final Cut Pro — select the overlay clip, open Transform, set Position\n\
         (assumes the FCP project/timeline is {full_w} x {full_h}):\n\
         \tX = {fcp_x}\n\
         \tY = {fcp_y}\n",
    );

    let sidecar = format!("{output_path}.placement.txt");
    match std::fs::write(&sidecar, body) {
        Ok(()) => log::info!("render_video: wrote placement info to {sidecar}"),
        Err(e) => log::warn!("failed to write placement sidecar {sidecar}: {e}"),
    }
}

fn resolve_ffmpeg() -> String {
    // On Windows the binary is ffmpeg.exe; on Unix it's ffmpeg.
    let bin_name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    if let Ok(exe) = std::env::current_exe() {
        // Dev: {repo}/resources/ffmpeg[.exe] (skip zero-byte build stub)
        if let Some(root) = exe.ancestors().find(|p| p.join("resources").exists()) {
            let dev = root.join("resources").join(bin_name);
            if std::fs::metadata(&dev)
                .map(|m| m.len() > 0)
                .unwrap_or(false)
            {
                ensure_executable(&dev);
                return dev.to_string_lossy().to_string();
            }
        }
        // Production macOS .app: exe is Contents/MacOS/cyclemetry,
        // Tauri resources land at Contents/Resources/
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            let bundled = contents.join("Resources").join(bin_name);
            if std::fs::metadata(&bundled)
                .map(|m| m.len() > 0)
                .unwrap_or(false)
            {
                ensure_executable(&bundled);
                return bundled.to_string_lossy().to_string();
            }
        }
        // Production Windows: Tauri NSIS bundles resources next to the exe
        // (destination ".") or inside a resources/ subdirectory.  Check both.
        #[cfg(windows)]
        if let Some(exe_dir) = exe.parent() {
            for candidate in &[
                exe_dir.join(bin_name),
                exe_dir.join("resources").join(bin_name),
            ] {
                if std::fs::metadata(candidate)
                    .map(|m| m.len() > 0)
                    .unwrap_or(false)
                {
                    log::info!("resolve_ffmpeg: found Windows bundled ffmpeg at {candidate:?}");
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
        // Production Linux: depending on the bundle target, resources may sit
        // next to the executable or under a sibling lib/resources directory.
        #[cfg(target_os = "linux")]
        if let Some(exe_dir) = exe.parent() {
            let app_name = std::env::current_exe()
                .ok()
                .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
                .unwrap_or_else(|| "cyclemetry".to_string());
            for candidate in &[
                exe_dir.join(bin_name),
                exe_dir.join("resources").join(bin_name),
                exe_dir
                    .parent()
                    .unwrap_or(exe_dir)
                    .join("lib")
                    .join(&app_name)
                    .join(bin_name),
                exe_dir
                    .parent()
                    .unwrap_or(exe_dir)
                    .join("lib")
                    .join(&app_name)
                    .join("resources")
                    .join(bin_name),
            ] {
                if std::fs::metadata(candidate)
                    .map(|m| m.len() > 0)
                    .unwrap_or(false)
                {
                    ensure_executable(candidate);
                    log::info!("resolve_ffmpeg: found Linux bundled ffmpeg at {candidate:?}");
                    return candidate.to_string_lossy().to_string();
                }
            }
        }
    }
    // Homebrew on macOS doesn't modify the system PATH visible to .app bundles.
    // Check known install locations before falling back to PATH lookup.
    for candidate in &[
        "/opt/homebrew/bin/ffmpeg", // Apple Silicon Homebrew
        "/usr/local/bin/ffmpeg",    // Intel Homebrew
    ] {
        let p = std::path::Path::new(candidate);
        if std::fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false) {
            log::info!("resolve_ffmpeg: using Homebrew ffmpeg at {candidate}");
            return candidate.to_string();
        }
    }

    log::warn!("resolve_ffmpeg: no ffmpeg found — falling back to PATH lookup");
    // On Windows, just "ffmpeg" works if it's on PATH (cmd resolves .exe automatically)
    "ffmpeg".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FfmpegEncoder {
    codec: String,
    mode: &'static str,
}

fn ffmpeg_command(ffmpeg_bin: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new(ffmpeg_bin);
        // Suppress the console window Windows opens for console-subsystem
        // executables when spawned from a GUI process (CREATE_NO_WINDOW).
        cmd.creation_flags(0x08000000);
        cmd
    }
    #[cfg(not(windows))]
    {
        Command::new(ffmpeg_bin)
    }
}

/// Select the best alpha-preserving ProRes encoder this FFmpeg can actually run.
///
/// Cyclemetry exports transparent overlays as ProRes 4444. Windows/Linux GPU
/// encoders generally accelerate H.264/HEVC/AV1, not ProRes 4444 with alpha, so
/// `prores_ks` remains the portable fallback unless FFmpeg gains another working
/// ProRes hardware encoder on those platforms.
fn select_ffmpeg_encoder(ffmpeg_bin: &str) -> Result<FfmpegEncoder, String> {
    if let Ok(codec) = std::env::var("CYCLEMETRY_FFMPEG_CODEC") {
        let codec = codec.trim();
        if !codec.is_empty() {
            log::warn!("render_video: using encoder override CYCLEMETRY_FFMPEG_CODEC={codec}");
            preflight_ffmpeg_encoder(ffmpeg_bin, codec)
                .map_err(|e| format!("FFmpeg encoder override '{codec}' failed preflight: {e}"))?;
            return Ok(FfmpegEncoder {
                codec: codec.to_string(),
                mode: "override",
            });
        }
    }

    let encoders = match available_ffmpeg_encoders(ffmpeg_bin) {
        Ok(encoders) => Some(encoders),
        Err(e) => {
            log::warn!("render_video: unable to list FFmpeg encoders: {e}");
            None
        }
    };

    let should_try_videotoolbox = encoders
        .as_ref()
        .map(|e| e.contains("prores_videotoolbox"))
        .unwrap_or_else(|| cfg!(target_os = "macos"));
    if should_try_videotoolbox {
        match preflight_ffmpeg_encoder(ffmpeg_bin, "prores_videotoolbox") {
            Ok(()) => {
                return Ok(FfmpegEncoder {
                    codec: "prores_videotoolbox".to_string(),
                    mode: "hardware",
                });
            }
            Err(e) => {
                log::warn!(
                    "render_video: prores_videotoolbox is present but failed preflight; \
                     falling back to prores_ks: {e}"
                );
            }
        }
    } else if cfg!(target_os = "macos") {
        log::warn!("render_video: prores_videotoolbox is not available in this FFmpeg build");
    }

    if encoder_is_listed(encoders.as_ref(), "prores_ks") {
        preflight_ffmpeg_encoder(ffmpeg_bin, "prores_ks")
            .map_err(|e| format!("FFmpeg prores_ks preflight failed: {e}"))?;
        return Ok(FfmpegEncoder {
            codec: "prores_ks".to_string(),
            mode: "software",
        });
    }

    Err("FFmpeg does not provide a working ProRes 4444 encoder. Install an FFmpeg build with prores_ks support.".to_string())
}

fn available_ffmpeg_encoders(ffmpeg_bin: &str) -> Result<HashSet<String>, String> {
    let output = ffmpeg_command(ffmpeg_bin)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("failed to run '{ffmpeg_bin} -encoders': {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("'{ffmpeg_bin} -encoders' exited with {}", output.status)
        } else {
            format!(
                "'{ffmpeg_bin} -encoders' exited with {}: {stderr}",
                output.status
            )
        });
    }

    Ok(parse_ffmpeg_encoder_names(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn parse_ffmpeg_encoder_names(output: &str) -> HashSet<String> {
    output
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1))
        .map(str::to_string)
        .collect()
}

fn encoder_is_listed(encoders: Option<&HashSet<String>>, codec: &str) -> bool {
    encoders.map(|e| e.contains(codec)).unwrap_or(true)
}

fn preflight_ffmpeg_encoder(ffmpeg_bin: &str, codec: &str) -> Result<(), String> {
    use std::io::Write as _;

    let mut cmd = ffmpeg_command(ffmpeg_bin);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        "640x360",
        "-r",
        "1",
        "-i",
        "-",
        "-frames:v",
        "1",
        "-c:v",
        codec,
        "-profile:v",
        "4444",
        "-f",
        "null",
        "-",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start FFmpeg preflight: {e}"))?;

    let write_error = if let Some(mut stdin) = child.stdin.take() {
        let frame = vec![0u8; 640 * 360 * 4];
        stdin.write_all(&frame).err().map(|e| e.to_string())
    } else {
        Some("FFmpeg preflight stdin was not available".to_string())
    };

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for FFmpeg preflight: {e}"))?;

    if output.status.success() && write_error.is_none() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if let Some(e) = write_error {
        if stderr.is_empty() {
            format!("failed to write FFmpeg preflight frame: {e}")
        } else {
            format!("failed to write FFmpeg preflight frame: {e}; stderr: {stderr}")
        }
    } else if stderr.is_empty() {
        format!("preflight exited with {}", output.status)
    } else {
        format!("preflight exited with {}: {stderr}", output.status)
    })
}

fn ensure_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            if perms.mode() & 0o111 == 0 {
                perms.set_mode(perms.mode() | 0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffmpeg_encoder_names() {
        let encoders = parse_ffmpeg_encoder_names(
            "Encoders:\n\
             V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n\
             VFS... prores_ks            Apple ProRes (iCodec Pro)\n\
             V....D prores_videotoolbox  VideoToolbox ProRes Encoder\n",
        );

        assert!(encoders.contains("h264_videotoolbox"));
        assert!(encoders.contains("prores_ks"));
        assert!(encoders.contains("prores_videotoolbox"));
    }
}
