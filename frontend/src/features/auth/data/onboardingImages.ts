/**
 * Sample event-card data shown during onboarding topic selection.
 *
 * Each key matches an EventCategory value so the onboarding UI can look
 * up a representative card per category.
 */
export const ONBOARDING_EVENT_CARDS: Record<
  string,
  { title: string; org: string; image: string }
> = {
  Clubs: {
    title: "Club Fair 2026",
    org: "Student Union",
    image:
      "https://images.unsplash.com/photo-1529543544282-ea69407b3656?w=400&h=200&fit=crop",
  },
  Academic: {
    title: "Research Symposium",
    org: "Graduate Studies",
    image:
      "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=400&h=200&fit=crop",
  },
  Religious: {
    title: "Interfaith Gathering",
    org: "Chaplain's Office",
    image:
      "https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=400&h=200&fit=crop",
  },
  Cultural: {
    title: "Diwali Celebration",
    org: "South Asian Association",
    image:
      "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400&h=200&fit=crop",
  },
  "Social & Games": {
    title: "Welcome Week BBQ",
    org: "Residence Life",
    image:
      "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=200&fit=crop",
  },
  Sports: {
    title: "Intramural Volleyball",
    org: "Campus Rec",
    image:
      "https://images.unsplash.com/photo-1461896836934-bd45ba1e9271?w=400&h=200&fit=crop",
  },
  Career: {
    title: "Tech Career Fair",
    org: "Career Centre",
    image:
      "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=400&h=200&fit=crop",
  },
};
