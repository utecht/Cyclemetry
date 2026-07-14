//! Keeps macOS from throttling a render while the app sits in the background.
//!
//! Renders run on a blocking worker with a rayon frame loop, so a minimized
//! window can't stop them. But once every window is minimized or occluded,
//! AppKit decides the app is idle and applies App Nap: coalesced timers and
//! demoted thread priority, which on Apple Silicon means the render's workers
//! land on the efficiency cores and the whole export crawls.
//!
//! An activity assertion tells macOS this is user-initiated work. It is scoped
//! to the render and released on drop, so an idle Cyclemetry still naps like a
//! good laptop citizen. `UserInitiated` also implies `IdleSystemSleepDisabled`
//! (the machine won't idle-sleep mid-export); display sleep is still allowed.

pub use platform::RenderActivity;

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    pub struct RenderActivity(Retained<ProtocolObject<dyn NSObjectProtocol>>);

    impl RenderActivity {
        /// Hold this for as long as the render runs; dropping it re-enables App Nap.
        pub fn begin(reason: &str) -> Self {
            let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                NSActivityOptions::UserInitiated,
                &NSString::from_str(reason),
            );
            log::info!("App Nap suspended for: {reason}");
            Self(token)
        }
    }

    impl Drop for RenderActivity {
        fn drop(&mut self) {
            // SAFETY: the token came from beginActivityWithOptions on the process's
            // own NSProcessInfo (a singleton), and is ended exactly once, here.
            unsafe { NSProcessInfo::processInfo().endActivity(&self.0) };
            log::info!("App Nap re-enabled");
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    /// No-op: App Nap is a macOS behaviour.
    pub struct RenderActivity;

    impl RenderActivity {
        pub fn begin(_reason: &str) -> Self {
            Self
        }
    }
}
