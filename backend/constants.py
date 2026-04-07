"""
Canonical event categories. Must match frontend EVENT_CATEGORIES.
Used for validation on create/update and for seeding/normalization.
"""

EVENT_CATEGORIES = (
    "Academics",
    "Studying",
    "Career",
    "Networking",
    "Games",
    "Partying",
    "Athletics",
    "Art",
    "Dance",
    "Culture",
    "Religion",
    "Advocacy",
    "Technology",
    "Design",
    "Entrepreneurship",
    "Health",
    "Wellness",
    "Mental Health",
    "Music",
    "Sports",
    "Food",
    "Volunteering",
)

# Map user profile interests to event categories.
# User interests (12) don't map 1:1 to event categories (22).
INTEREST_TO_CATEGORIES: dict[str, list[str]] = {
    "Academic": ["Academics", "Studying"],
    "Social": ["Partying", "Games", "Dance"],
    "Career": ["Career", "Networking", "Entrepreneurship"],
    "Sports": ["Athletics", "Sports"],
    "Music": ["Music"],
    "Art": ["Art", "Design"],
    "Technology": ["Technology"],
    "Gaming": ["Games"],
    "Food": ["Food"],
    "Networking": ["Networking", "Career"],
    "Health": ["Health", "Wellness", "Mental Health"],
    "Cultural": ["Culture", "Religion", "Advocacy"],
}

# Map legacy/old category values to canonical (for migrations and seeds).
CATEGORY_NORMALIZE_MAP = {
    "Academic": "Academics",
    "Clubs": "Academics",
    "Religious": "Religion",
    "Cultural": "Culture",
    "Social & Games": "Games",
    "Sports & Fitness": "Sports",
    "Career & Networking": "Career",
    "Creative Arts": "Art",
    "Arts & Crafts": "Art",
    "Health & Wellness": "Health",
    "Music & Performance": "Music",
}
