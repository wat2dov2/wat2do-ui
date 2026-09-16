"""Event category and interest mapping constants."""

EVENT_CATEGORIES = (
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
)

# Interests map 1:1 to categories now that we have a simplified taxonomy.
INTEREST_TO_CATEGORIES: dict[str, list[str]] = {
    "Arts & Culture": ["Arts & Culture"],
    "Academics & Science": ["Academics & Science"],
    "Business": ["Business"],
    "Community Service": ["Community Service"],
    "Environment": ["Environment"],
    "Games & Recreation": ["Games & Recreation"],
    "Health": ["Health"],
    "Media & Web": ["Media & Web"],
    "Politics & Advocacy": ["Politics & Advocacy"],
    "Religion & Spirituality": ["Religion & Spirituality"],
}
