//! Platform-agnostic rendering core: GPX/FIT parsing, template model, and
//! Skia frame rendering. Shared by the Tauri desktop app and the wasm web
//! companion. Desktop-only concerns (ffmpeg encoding, rayon frame loop, disk
//! management) live in `src-tauri/src/render/`.

pub mod activity;
pub mod chart;
pub mod color;
pub mod frame;
pub mod template;
pub mod units;
