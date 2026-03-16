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
