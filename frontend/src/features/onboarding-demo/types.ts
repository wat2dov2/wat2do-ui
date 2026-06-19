export type SocialMode = "solo" | "friends" | "meet_people";

export type EventReaction = "interested" | "maybe" | "not_for_me";

export type OnboardingDemoState = {
  source?: string;
  interests: string[];
  availability: string[];
  socialMode?: SocialMode;
  reactions: Record<number, EventReaction>;
  proTrialAccepted: boolean;
};

export type OnboardingDemoStep =
  | "welcome"
  | "campus_intent"
  | "availability"
  | "event_match"
  | "radar_payoff"
  | "build_week"
  | "pro_unlock"
  | "pro_challenge"
  | "home";
