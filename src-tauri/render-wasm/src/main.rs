//! C-style exports over render-core for the web companion (Instagram-story
//! style clips and stills rendered fully client-side).
//!
//! The JS side seeds Emscripten's in-memory filesystem before calling
//! `cm_init`: fonts under /fonts, image assets under /assets, and the GPX
//! file anywhere (its path is passed to `cm_init`). That keeps render-core's
//! path-based font/asset loading working unmodified.
//!
//! Single global session: the page renders one template + activity at a time.

use std::ffi::CString;
use std::sync::Mutex;

use render_core::activity::Activity;
use render_core::frame::{SceneCache, render_frame};
use render_core::template::Template;

struct Session {
    template: Template,
    activity: Activity,
    cache: SceneCache,
    frame_buf: Vec<u8>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<CString>> = Mutex::new(None);

fn fail(msg: String) -> i32 {
    *LAST_ERROR.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(CString::new(msg).unwrap_or_default());
    -1
}

/// Rust panics may not unwind across the extern "C" boundary (the runtime
/// aborts the whole wasm instance). Catch them and surface as error returns.
fn guarded(f: impl FnOnce() -> i32 + std::panic::UnwindSafe) -> i32 {
    match std::panic::catch_unwind(f) {
        Ok(rc) => rc,
        Err(payload) => {
            let msg = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown panic".to_string());
            fail(format!("internal panic: {msg}"))
        }
    }
}

unsafe fn slice_from<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

unsafe fn str_from<'a>(ptr: *const u8, len: usize) -> Result<&'a str, i32> {
    std::str::from_utf8(unsafe { slice_from(ptr, len) })
        .map_err(|e| fail(format!("invalid utf-8 argument: {e}")))
}

/// Allocate `len` bytes the JS side can write into (returns pointer into wasm memory).
#[unsafe(no_mangle)]
pub extern "C" fn cm_alloc(len: usize) -> *mut u8 {
    let mut buf = vec![0u8; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn cm_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, len, len) });
    }
}

/// Write bytes to Emscripten's MEMFS (fonts, GPX, image assets), creating
/// parent directories as needed. Returns 0 on success.
#[unsafe(no_mangle)]
pub extern "C" fn cm_write_file(
    path_ptr: *const u8,
    path_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) -> i32 {
    let path = match unsafe { str_from(path_ptr, path_len) } {
        Ok(p) => p,
        Err(rc) => return rc,
    };
    let data = unsafe { slice_from(data_ptr, data_len) };
    if let Some(parent) = std::path::Path::new(path).parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return fail(format!("mkdir {} failed: {e}", parent.display()));
        }
    }
    match std::fs::write(path, data) {
        Ok(()) => 0,
        Err(e) => fail(format!("write {path} failed: {e}")),
    }
}

/// Parse the template JSON + GPX and build the scene cache. Pass out_w/out_h
/// of 0 to render at the template's native resolution. An empty GPX path uses
/// a synthetic demo activity. Returns 0 on success, -1 on error (see
/// `cm_last_error`).
#[unsafe(no_mangle)]
pub extern "C" fn cm_init(
    template_ptr: *const u8,
    template_len: usize,
    gpx_path_ptr: *const u8,
    gpx_path_len: usize,
    out_w: u32,
    out_h: u32,
) -> i32 {
    guarded(move || {
        cm_init_impl(
            template_ptr,
            template_len,
            gpx_path_ptr,
            gpx_path_len,
            out_w,
            out_h,
        )
    })
}

fn cm_init_impl(
    template_ptr: *const u8,
    template_len: usize,
    gpx_path_ptr: *const u8,
    gpx_path_len: usize,
    out_w: u32,
    out_h: u32,
) -> i32 {
    let template_json = match unsafe { str_from(template_ptr, template_len) } {
        Ok(s) => s,
        Err(rc) => return rc,
    };
    let gpx_path = match unsafe { str_from(gpx_path_ptr, gpx_path_len) } {
        Ok(s) => s,
        Err(rc) => return rc,
    };

    let raw: serde_json::Value = match serde_json::from_str(template_json) {
        Ok(v) => v,
        Err(e) => return fail(format!("template JSON parse error: {e}")),
    };
    let target = (out_w > 0 && out_h > 0).then_some((out_w, out_h));
    let template = match Template::from_value_scaled(raw, target) {
        Ok(t) => t,
        Err(e) => return fail(format!("template error: {e}")),
    };

    let synthetic = gpx_path.is_empty();
    let activity = if synthetic {
        Activity::synthetic(60)
    } else {
        match Activity::from_file(gpx_path) {
            Ok(a) => a,
            Err(e) => return fail(format!("activity parse error: {e}")),
        }
    };
    let activity = match activity.sample_for_scene(&template.scene, synthetic) {
        Ok(a) => a,
        Err(e) => return fail(format!("activity timeline error: {e}")),
    };

    let cache = match SceneCache::build(&activity, &template, "/fonts", &["/assets"]) {
        Ok(c) => c,
        Err(e) => return fail(format!("scene cache build failed: {e}")),
    };

    *SESSION.lock().unwrap_or_else(|e| e.into_inner()) = Some(Session {
        template,
        activity,
        cache,
        frame_buf: Vec::new(),
    });
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn cm_width() -> u32 {
    SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(0, |s| s.template.scene.width)
}

#[unsafe(no_mangle)]
pub extern "C" fn cm_height() -> u32 {
    SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(0, |s| s.template.scene.height)
}

#[unsafe(no_mangle)]
pub extern "C" fn cm_frame_count() -> u32 {
    SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(0, |s| s.activity.data_len() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn cm_fps() -> u32 {
    SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(0, |s| s.template.scene.fps)
}

/// Render frame `frame_idx` (clamped) and return a pointer to the RGBA buffer
/// (cm_width × cm_height × 4 bytes). The buffer stays valid until the next
/// cm_render / cm_init call. Returns null if no session is initialized.
#[unsafe(no_mangle)]
pub extern "C" fn cm_render(frame_idx: u32) -> *const u8 {
    match std::panic::catch_unwind(move || cm_render_impl(frame_idx)) {
        Ok(ptr) => ptr,
        Err(_) => {
            let _ = fail("internal panic during frame render".to_string());
            std::ptr::null()
        }
    }
}

fn cm_render_impl(frame_idx: u32) -> *const u8 {
    let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    let Some(session) = guard.as_mut() else {
        return std::ptr::null();
    };
    let idx = (frame_idx as usize).min(session.activity.data_len().saturating_sub(1));
    session.frame_buf = render_frame(
        idx,
        &session.cache,
        &session.activity,
        &session.template,
        None,
        None,
    );
    // The pipeline renders BGRA (Skia native, what desktop feeds FFmpeg);
    // canvas ImageData wants RGBA.
    for px in session.frame_buf.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    session.frame_buf.as_ptr()
}

/// Minimal Skia smoke test: create a raster surface, clear it, snapshot.
/// Returns the surface's pixel byte count, or 0 on failure. Exists to isolate
/// wasm linkage issues from the full render pipeline.
#[unsafe(no_mangle)]
pub extern "C" fn cm_skia_smoke() -> u32 {
    eprintln!("skia smoke: creating ImageInfo");
    let info = skia_safe::ImageInfo::new(
        skia_safe::ISize::new(64, 64),
        skia_safe::ColorType::BGRA8888,
        skia_safe::AlphaType::Premul,
        None,
    );
    eprintln!("skia smoke: creating raster surface");
    let Some(mut surface) = skia_safe::surfaces::raster(&info, None, None) else {
        return 0;
    };
    eprintln!("skia smoke: clearing canvas");
    surface.canvas().clear(skia_safe::Color::RED);
    eprintln!("skia smoke: snapshotting");
    let image = surface.image_snapshot();
    eprintln!("skia smoke: done");
    (image.width() * image.height() * 4) as u32
}

/// Null-terminated message for the most recent error, or null if none.
#[unsafe(no_mangle)]
pub extern "C" fn cm_last_error() -> *const std::ffi::c_char {
    LAST_ERROR
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map_or(std::ptr::null(), |s| s.as_ptr())
}

fn main() {
    // Emscripten runs main() on module load; all real entry points are the
    // exported cm_* functions above. Panics crossing the extern "C" boundary
    // abort the wasm instance — print the message + location to the console
    // first so failures are debuggable from the browser.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("cyclemetry render panic: {info}");
    }));
}
