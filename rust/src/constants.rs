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

/// `core.constants.clubs.CLUB_CATEGORIES`, the same list as events'.
pub const CLUB_CATEGORIES: [&str; 10] = EVENT_CATEGORIES;

/// `core.constants.events.INTEREST_TO_CATEGORIES`: each interest, in order,
/// to the event categories it follows.
pub const INTEREST_TO_CATEGORIES: [(&str, &[&str]); 10] = [
    ("Arts & Culture", &["Arts & Culture"]),
    ("Academics & Science", &["Academics & Science"]),
    ("Business", &["Business"]),
    ("Community Service", &["Community Service"]),
    ("Environment", &["Environment"]),
    ("Games & Recreation", &["Games & Recreation"]),
    ("Health", &["Health"]),
    ("Media & Web", &["Media & Web"]),
    ("Politics & Advocacy", &["Politics & Advocacy"]),
    ("Religion & Spirituality", &["Religion & Spirituality"]),
];

/// `core.constants.statuses.REPORT_STATUSES`, in order.
pub const REPORT_STATUSES: [&str; 3] = ["pending", "resolved", "dismissed"];

/// `core.constants.clubs.CLUB_TYPE_INDEPENDENT`.
pub const CLUB_TYPE_INDEPENDENT: &str = "independent";

/// `core.constants.validation` limits on request fields.
pub const MAX_FULL_NAME_LENGTH: usize = 255;
pub const MAX_FACULTY_LENGTH: usize = 255;
pub const MAX_SCHOOL_LENGTH: usize = 255;
pub const MAX_INTEREST_LENGTH: usize = 100;
pub const MAX_INTERESTS_COUNT: usize = 50;
pub const MAX_REJECTION_REASON_LENGTH: usize = 2000;
pub const MAX_AVATAR_URL_LENGTH: usize = 2048;
pub const MAX_URL_LENGTH: usize = 2048;
pub const MAX_SEARCH_QUERY_LENGTH: usize = 200;
pub const MAX_CLUB_TYPE_LENGTH: usize = 100;
pub const MAX_CLUB_CATEGORY_LENGTH: usize = 100;
pub const MAX_CLUB_CATEGORY_COUNT: usize = 20;

/// `core.constants.pagination.MAX_LIST_LIMIT`, also the default of `/users/`.
pub const MAX_LIST_LIMIT: i64 = 100_000;

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
