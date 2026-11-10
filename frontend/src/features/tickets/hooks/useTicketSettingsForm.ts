import { useState } from "react";
import { useTranslation } from "react-i18next";
import { controlBox } from "@/shared/config/controlBox";
import type {
  ApiEventTicketingResponse,
  ApiEventTicketingUpdate,
  ApiTicketTierUpdate,
} from "@/shared/generated";

const { minimumPriceCents, maximumPriceCents, maximumCapacity, maximumTiers } =
  controlBox.ticketing;

/** One tier as the club types it. */
export interface TierDraft {
  /** Stable for React while the tier is new and has no id yet. */
  key: string;
  /** Null for a tier the club is adding now. */
  id: string | null;
  name: string;
  /** Empty for a free tier. */
  price: string;
  /** Empty for no limit of its own. */
  capacity: string;
}

/** What is wrong with one tier, if anything. */
export interface TierProblems {
  name?: "required" | "repeated";
  price?: boolean;
  capacity?: boolean;
}

/** A typed price in cents: zero when empty, null outside the allowed range; "12,50" counts as 12.50. */
export function centsFromInput(value: string): number | null {
  if (!value.trim()) return 0;
  const cents = Math.round(Number(value.trim().replace(",", ".")) * 100);
  return cents >= minimumPriceCents && cents <= maximumPriceCents ? cents : null;
}

/** A typed limit: null when empty, NaN outside the allowed range. */
function limitFromInput(value: string): number | null {
  if (!value) return null;
  const limit = Number(value);
  return limit > 0 && limit <= maximumCapacity ? limit : Number.NaN;
}

const newKey = () => crypto.randomUUID();

function draftsFrom(ticketing: ApiEventTicketingResponse | null, defaultName: string): TierDraft[] {
  if (!ticketing) return [{ key: newKey(), id: null, name: defaultName, price: "", capacity: "" }];
  return ticketing.tiers.map((tier) => ({
    key: tier.id,
    id: tier.id,
    name: tier.name,
    price: tier.price_cents > 0 ? (tier.price_cents / 100).toFixed(2) : "",
    capacity: tier.capacity ? String(tier.capacity) : "",
  }));
}

/**
 * The ticket settings form: the event's one limit, its tiers, and pausing.
 * Problems show once the club tries to save.
 */
export function useTicketSettingsForm(ticketing: ApiEventTicketingResponse | null) {
  const { t } = useTranslation();
  const [tiers, setTiers] = useState(() =>
    draftsFrom(ticketing, t("tickets.settings.defaultTierName")),
  );
  const [capacity, setCapacity] = useState(ticketing?.capacity ? String(ticketing.capacity) : "");
  const [paused, setPaused] = useState(ticketing?.paused ?? false);
  const [submitted, setSubmitted] = useState(false);

  const names = tiers.map((tier) => tier.name.trim().toLowerCase());
  const problems: TierProblems[] = tiers.map((tier, index) => ({
    name: !names[index]
      ? "required"
      : names.indexOf(names[index]) !== index
        ? "repeated"
        : undefined,
    price: centsFromInput(tier.price) === null,
    capacity: Number.isNaN(limitFromInput(tier.capacity)),
  }));
  const capacityInvalid = Number.isNaN(limitFromInput(capacity));
  const valid =
    !capacityInvalid &&
    problems.every((problem) => !problem.name && !problem.price && !problem.capacity);
  const paid = tiers.some((tier) => (centsFromInput(tier.price) ?? 0) > 0);

  const updateTier = (key: string, change: Partial<Omit<TierDraft, "key" | "id">>) =>
    setTiers((current) => current.map((tier) => (tier.key === key ? { ...tier, ...change } : tier)));
  const addTier = () =>
    setTiers((current) => [...current, { key: newKey(), id: null, name: "", price: "", capacity: "" }]);
  const removeTier = (key: string) => setTiers((current) => current.filter((tier) => tier.key !== key));

  /** The settings to save, or null (with every problem shown) when something is wrong. */
  const submit = (): ApiEventTicketingUpdate | null => {
    setSubmitted(true);
    if (!valid) return null;
    return {
      capacity: limitFromInput(capacity),
      paused,
      tiers: tiers.map(
        (tier): ApiTicketTierUpdate => ({
          id: tier.id,
          name: tier.name.trim(),
          price_cents: centsFromInput(tier.price) ?? 0,
          capacity: limitFromInput(tier.capacity),
        }),
      ),
    };
  };

  return {
    tiers,
    capacity,
    paused,
    paid,
    /** Problems to show: none until the club tries to save. */
    problems: submitted ? problems : tiers.map((): TierProblems => ({})),
    capacityInvalid: submitted && capacityInvalid,
    canAddTier: tiers.length < maximumTiers,
    setCapacity,
    setPaused,
    updateTier,
    addTier,
    removeTier,
    submit,
  };
}
