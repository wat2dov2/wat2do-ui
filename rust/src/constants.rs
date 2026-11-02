//! Values mirrored from `backend/core/constants`.
//! `backend/tests/test_rust_constants.py` fails when the two drift apart.

/// `core.constants.events.EVENT_CATEGORIES`, in order.
pub const EVENT_CATEGORIES: [&str; 10] = [
    "Arts & Culture",
    "Academics & Science",
    "Business",
    "Community Service",
    "Environment",
    "Games & Recreation",
    "Health",
    "Media & Web",
    "Politics & Advocacy",
    "Religion & Spirituality",
];

pub const MAX_EVENT_DESCRIPTION_LENGTH: i32 = 5000;
pub const MAX_POSITION_DESCRIPTION_LENGTH: i32 = 4000;
pub const MAX_CLUB_NAME_LENGTH: usize = 200;

pub const BUCKET_EVENT_IMAGES: &str = "event-images";
pub const BUCKET_EVENT_VIDEOS: &str = "event-videos";
pub const BUCKET_CLUB_LOGOS: &str = "organization-logos";

/// `MAX_AVATAR_SIZE_BYTES`, the club logo bucket's limit.
pub const MAX_AVATAR_SIZE_BYTES: usize = 2 * 1024 * 1024;

/// `core.constants.notifications`: notification types and delivery statuses.
pub const NOTIFICATION_TYPE_MORNING_EMAIL: &str = "morning_email";
pub const NOTIFICATION_TYPE_EVENT_REMINDER: &str = "event_reminder";
pub const NOTIFICATION_TYPE_EVENT_CHANGE: &str = "event_change";
pub const NOTIFICATION_STATUS_SENT: &str = "sent";
pub const NOTIFICATION_STATUS_FAILED: &str = "failed";

/// `core.constants.pagination`: page sizes and the deepest page.
pub const DEFAULT_PAGE_SIZE: i64 = 50;
pub const MAX_PAGE_SIZE: i64 = 100;
pub const MAX_PAGE_NUMBER: i64 = 1000;
