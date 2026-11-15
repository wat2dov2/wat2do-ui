//! Ticket releases: an event's tickets go on sale in releases, each at its
//! own time, price and number of tickets for every date with tickets. A
//! release stays on sale until it sells out or the date is over, so releases
//! add up, and a buyer always draws from the earliest release on sale with
//! tickets left, at its price.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::model::ReleaseRow;
use crate::api::errors::ApiError;
use crate::api::messages::{
    TICKET_CAPACITY_TOO_HIGH, TICKET_PRICE_OUT_OF_RANGE, TICKET_RELEASE_UNLIMITED_NOT_LAST,
    TICKET_RELEASES_MIXED_PRICES, TICKET_RELEASES_SAME_TIME, TICKET_RELEASES_TOO_MANY,
};
use crate::controlbox::TICKETING;

/// Seats a release has given out on a date: valid tickets, plus seats buyers
/// still hold on Stripe Checkout. Keyed by (release, date).
pub type SeatsTaken = HashMap<(Uuid, Uuid), i64>;

/// What one date of an event offers at a moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offer<'a> {
    /// The release a ticket comes from now, and how many it has left
    /// (`None` without a limit).
    OnSale {
        release: &'a ReleaseRow,
        remaining: Option<i64>,
    },
    /// Nothing is on sale yet: this release is next.
    NotYet { release: &'a ReleaseRow },
    /// Every release sold out.
    SoldOut,
}

/// What `date` offers at `now`, from `releases` in the order they go on sale.
pub fn offer<'a>(
    releases: &'a [ReleaseRow],
    taken: &SeatsTaken,
    date: Uuid,
    now: DateTime<Utc>,
) -> Offer<'a> {
    for release in releases {
        if release.on_sale_at > now {
            return Offer::NotYet { release };
        }
        let remaining = left(release, taken, date);
        if remaining != Some(0) {
            return Offer::OnSale { release, remaining };
        }
    }
    Offer::SoldOut
}

/// Tickets `release` has left for `date`; `None` without a limit.
fn left(release: &ReleaseRow, taken: &SeatsTaken, date: Uuid) -> Option<i64> {
    release.quantity.map(|quantity| {
        let used = taken.get(&(release.id, date)).copied().unwrap_or(0);
        (i64::from(quantity) - used).max(0)
    })
}

/// Tickets `date` has left across every release, on sale or not; `None`
/// when some release has no limit.
pub fn left_in_all(releases: &[ReleaseRow], taken: &SeatsTaken, date: Uuid) -> Option<i64> {
    releases
        .iter()
        .map(|release| left(release, taken, date))
        .sum()
}

/// A club's releases, as it set them: one price kind, distinct sale times,
/// prices and limits in range, and no release after one without a limit
/// (it would never sell out, so the next would never be reached).
/// Returns them in the order they go on sale.
pub fn check(mut releases: Vec<ReleaseRow>) -> Result<Vec<ReleaseRow>, ApiError> {
    if releases.len() > TICKETING.maximum_releases {
        return Err(ApiError::validation(TICKET_RELEASES_TOO_MANY));
    }
    releases.sort_by_key(|release| release.on_sale_at);
    let times: HashSet<DateTime<Utc>> = releases.iter().map(|release| release.on_sale_at).collect();
    if times.len() != releases.len() {
        return Err(ApiError::validation(TICKET_RELEASES_SAME_TIME));
    }
    let paid = releases
        .iter()
        .filter(|release| release.price_cents > 0)
        .count();
    if paid != 0 && paid != releases.len() {
        return Err(ApiError::validation(TICKET_RELEASES_MIXED_PRICES));
    }
    if releases.iter().any(|release| {
        release.price_cents > 0
            && !(TICKETING.minimum_price_cents..=TICKETING.maximum_price_cents)
                .contains(&release.price_cents)
    }) {
        return Err(ApiError::validation(TICKET_PRICE_OUT_OF_RANGE));
    }
    if releases.iter().any(|release| {
        release
            .quantity
            .is_some_and(|quantity| quantity > TICKETING.maximum_capacity)
    }) {
        return Err(ApiError::validation(TICKET_CAPACITY_TOO_HIGH));
    }
    if releases
        .iter()
        .rev()
        .skip(1)
        .any(|release| release.quantity.is_none())
    {
        return Err(ApiError::validation(TICKET_RELEASE_UNLIMITED_NOT_LAST));
    }
    Ok(releases)
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};

    use super::*;

    fn release(id: u128, day: u32, quantity: Option<i32>, price_cents: i32) -> ReleaseRow {
        ReleaseRow {
            id: Uuid::from_u128(id),
            on_sale_at: Utc.with_ymd_and_hms(2026, 11, day, 14, 0, 0).unwrap(),
            quantity,
            price_cents,
        }
    }

    fn detail(result: Result<Vec<ReleaseRow>, ApiError>) -> String {
        match result {
            Err(ApiError::Validation { detail, .. }) => detail,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn buyers_draw_from_the_earliest_release_with_tickets_left() {
        // 50 tickets from Nov 10 at $5, then 50 more from Nov 15 at $8.
        let releases = [release(1, 10, Some(50), 500), release(2, 15, Some(50), 800)];
        let date = Uuid::from_u128(100);
        let at = |day| Utc.with_ymd_and_hms(2026, 11, day, 15, 0, 0).unwrap();
        let mut taken = SeatsTaken::new();

        assert_eq!(
            offer(&releases, &taken, date, at(9)),
            Offer::NotYet {
                release: &releases[0]
            }
        );
        assert_eq!(
            offer(&releases, &taken, date, at(11)),
            Offer::OnSale {
                release: &releases[0],
                remaining: Some(50)
            }
        );
        // The first release sold out before the second goes on sale.
        taken.insert((releases[0].id, date), 50);
        assert_eq!(
            offer(&releases, &taken, date, at(12)),
            Offer::NotYet {
                release: &releases[1]
            }
        );
        assert_eq!(
            offer(&releases, &taken, date, at(16)),
            Offer::OnSale {
                release: &releases[1],
                remaining: Some(50)
            }
        );
        // A seat given back goes back to its own, cheaper release.
        taken.insert((releases[0].id, date), 49);
        assert_eq!(
            offer(&releases, &taken, date, at(16)),
            Offer::OnSale {
                release: &releases[0],
                remaining: Some(1)
            }
        );
        taken.insert((releases[0].id, date), 50);
        taken.insert((releases[1].id, date), 50);
        assert_eq!(offer(&releases, &taken, date, at(16)), Offer::SoldOut);
        // Each date has its own seats.
        assert_eq!(
            offer(&releases, &taken, Uuid::from_u128(101), at(16)),
            Offer::OnSale {
                release: &releases[0],
                remaining: Some(50)
            }
        );
        assert_eq!(left_in_all(&releases, &taken, date), Some(0));
        assert_eq!(left_in_all(&releases, &SeatsTaken::new(), date), Some(100));
        assert_eq!(
            left_in_all(&[release(3, 1, None, 0)], &SeatsTaken::new(), date),
            None
        );
    }

    #[test]
    fn a_club_sets_releases_that_can_all_be_reached() {
        let sorted = check(vec![
            release(2, 15, None, 800),
            release(1, 10, Some(50), 500),
        ])
        .unwrap();
        assert_eq!(sorted[0].id, Uuid::from_u128(1));
        assert_eq!(
            detail(check(vec![
                release(1, 10, None, 500),
                release(2, 15, Some(5), 800)
            ])),
            TICKET_RELEASE_UNLIMITED_NOT_LAST
        );
        assert_eq!(
            detail(check(vec![
                release(1, 10, Some(5), 0),
                release(2, 15, Some(5), 800)
            ])),
            TICKET_RELEASES_MIXED_PRICES
        );
        assert_eq!(
            detail(check(vec![
                release(1, 10, Some(5), 500),
                release(2, 10, Some(5), 800)
            ])),
            TICKET_RELEASES_SAME_TIME
        );
        assert_eq!(
            detail(check(vec![release(1, 10, Some(5), 1)])),
            TICKET_PRICE_OUT_OF_RANGE
        );
        assert_eq!(
            detail(check(vec![release(
                1,
                10,
                Some(TICKETING.maximum_capacity + 1),
                0
            )])),
            TICKET_CAPACITY_TOO_HIGH
        );
        let many = (0..=TICKETING.maximum_releases as u128)
            .map(|index| ReleaseRow {
                on_sale_at: Utc::now() + Duration::days(index as i64),
                ..release(index, 1, Some(1), 0)
            })
            .collect();
        assert_eq!(detail(check(many)), TICKET_RELEASES_TOO_MANY);
    }
}
