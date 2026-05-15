#![cfg(target_os = "macos")]
//! macOS UNUserNotificationCenter bridge.
//!
//! Replaces the legacy NSUserNotification path used by
//! tauri-plugin-notification (which Apple has effectively killed for
//! ad-hoc-signed bundles on Sonoma+) with the modern UserNotifications
//! framework. Sound is intentionally NOT set on `UNMutableNotificationContent`
//! — playback is owned entirely by the Rust audio pipeline
//! (`commands/audio.rs`) using rodio in-process, so it works in foreground
//! and background regardless of bundle signing. macOS DND still suppresses
//! the banner via UN; sound suppression is up to Alfredo's own settings.
//!
//! All Objective-C completion handlers fire on Apple's background queues; we
//! bridge them to a synchronous Rust API via a one-shot `sync_channel`.

use std::sync::OnceLock;
use std::sync::mpsc::sync_channel;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{MainThreadOnly, define_class, msg_send};
use objc2_foundation::{MainThreadMarker, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionStatus {
    Granted,
    Denied,
    Default,
}

impl PermissionStatus {
    /// Match the string contract the frontend already understood from
    /// `@tauri-apps/plugin-notification`: `"granted" | "denied" | "default"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Default => "default",
        }
    }
}

/// Wait this long for UserNotifications completion handlers before giving up.
/// In practice the system replies in well under a millisecond, but the calls
/// can hang indefinitely if the process is not a properly-signed bundle (e.g.
/// `npm run tauri dev`). We bound the wait to keep the UI responsive.
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(5);

/// Returns the user's current notification authorization status. Blocks the
/// calling thread on a background completion handler — do not call from the
/// main thread if you can avoid it (UI work uses `request_authorization` from
/// startup, where blocking briefly is fine).
pub fn authorization_status() -> PermissionStatus {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (tx, rx) = sync_channel::<UNAuthorizationStatus>(1);
    let block = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus();
        let _ = tx.send(status);
    });
    center.getNotificationSettingsWithCompletionHandler(&block);
    let result = rx.recv_timeout(COMPLETION_TIMEOUT);
    match result {
        Ok(s) if s == UNAuthorizationStatus::Authorized
            || s == UNAuthorizationStatus::Provisional
            || s == UNAuthorizationStatus::Ephemeral =>
        {
            PermissionStatus::Granted
        }
        Ok(s) if s == UNAuthorizationStatus::Denied => PermissionStatus::Denied,
        Ok(_) => PermissionStatus::Default,
        Err(_) => PermissionStatus::Default,
    }
}

/// Prompts the user for `.alert | .sound` authorization if not yet decided.
/// Returns `true` on grant (or already-granted), `false` otherwise.
pub fn request_authorization() -> bool {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (tx, rx) = sync_channel::<bool>(1);
    let block = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        let _ = tx.send(granted.as_bool());
    });
    let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
    center.requestAuthorizationWithOptions_completionHandler(options, &block);
    let result = rx.recv_timeout(Duration::from_secs(60));
    result.unwrap_or(false)
}

/// Posts a banner-only notification immediately (nil trigger). Returns `Err`
/// with the localized description if UserNotifications rejects the request.
/// Sound is deliberately omitted — playback lives in `commands/audio.rs`
/// (rodio in-process) so we don't depend on `usernoted` finding bundle audio
/// in ad-hoc-signed builds.
pub fn send(title: &str, body: &str) -> Result<(), String> {
    let content = UNMutableNotificationContent::new();
    let title_ns = NSString::from_str(title);
    let body_ns = NSString::from_str(body);
    content.setTitle(&title_ns);
    content.setBody(&body_ns);

    let identifier = NSString::from_str(&uuid::Uuid::new_v4().to_string());
    // `&UNMutableNotificationContent` autoderefs to `&UNNotificationContent`.
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &content, None);

    let center = UNUserNotificationCenter::currentNotificationCenter();
    let (tx, rx) = sync_channel::<Option<String>>(1);
    let block = RcBlock::new(move |err: *mut NSError| {
        let msg = if err.is_null() {
            None
        } else {
            // SAFETY: `err` is a non-null NSError pointer owned by the runtime
            // for the duration of this callback.
            let err_ref: &NSError = unsafe { &*err };
            Some(err_ref.localizedDescription().to_string())
        };
        let _ = tx.send(msg);
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
    match rx.recv_timeout(COMPLETION_TIMEOUT) {
        Ok(None) => Ok(()),
        Ok(Some(msg)) => Err(msg),
        Err(_) => Err("UserNotifications completion handler timed out".to_string()),
    }
}

define_class!(
    /// Foreground-presentation delegate. Without one, banners are suppressed
    /// while Alfredo is the frontmost app; we restore that behaviour by
    /// returning `[.banner, .list]` from `willPresent`. Sound is intentionally
    /// omitted — see module docs.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "AlfredoNotificationDelegate"]
    struct ForegroundPresenter;

    unsafe impl NSObjectProtocol for ForegroundPresenter {}

    unsafe impl UNUserNotificationCenterDelegate for ForegroundPresenter {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let opts = UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List;
            completion_handler.call((opts,));
        }
    }
);

impl ForegroundPresenter {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        // `set_ivars(())` is required even when the class has unit ivars: it
        // converts `Allocated<Self>` to `PartialInit<Self>`, which is what
        // `msg_send![super(_), init]` expects for a `define_class!` subclass.
        let this = Self::alloc(mtm).set_ivars(());
        // SAFETY: standard NSObject init on a freshly-allocated instance.
        unsafe { msg_send![super(this), init] }
    }
}

static DELEGATE: OnceLock<DelegateHandle> = OnceLock::new();

/// Wrapper so we can stash the delegate in a `OnceLock`. `Retained` is
/// neither `Send` nor `Sync` in the general case, but our delegate is a
/// plain NSObject subclass with no ivars and the underlying Objective-C
/// runtime is thread-safe for `retain`/`release`. We only ever read this
/// pointer to keep the delegate alive — never to call methods on it — so
/// the unsafe `Send`/`Sync` impls are sound.
struct DelegateHandle(#[allow(dead_code)] Retained<ForegroundPresenter>);
// SAFETY: see `DelegateHandle` doc — held only to prevent dealloc.
unsafe impl Send for DelegateHandle {}
// SAFETY: see `DelegateHandle` doc — held only to prevent dealloc.
unsafe impl Sync for DelegateHandle {}

/// Installs the foreground-presentation delegate on the shared
/// UNUserNotificationCenter. Must be called from the main thread. Idempotent.
pub fn install_presentation_delegate() {
    let Some(mtm) = MainThreadMarker::new() else {
        tracing::warn!("install_presentation_delegate called off main thread; skipping");
        return;
    };
    DELEGATE.get_or_init(|| {
        let delegate = ForegroundPresenter::new(mtm);
        let center = UNUserNotificationCenter::currentNotificationCenter();
        // `ProtocolObject::from_ref` adapts our concrete subclass into the
        // protocol-object reference the API expects.
        let proto: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
            ProtocolObject::from_ref(&*delegate);
        center.setDelegate(Some(proto));
        DelegateHandle(delegate)
    });
}
