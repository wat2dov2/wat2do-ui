"""Event category and interest mapping constants."""

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

# User interests (12) do not map 1:1 to event categories (22).
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

