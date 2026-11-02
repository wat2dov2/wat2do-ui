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
