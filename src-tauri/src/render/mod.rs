// Core rendering (activity, chart, color, frame, template, units) lives in
// the render-core crate so it can also target wasm; the modules the desktop
// crate touches are re-exported so existing crate::render::* paths keep
// working (chart/color are internal to render-core).
pub use render_core::{activity, frame, template, units};

pub mod scene;
pub mod video;
