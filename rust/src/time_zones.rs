//! IANA time zones for chrono, read from the tz database jiff bundles.
//!
//! Zone rules change by law, sometimes with weeks of notice: British Columbia
//! (America/Vancouver), Alberta (America/Edmonton) and Manitoba
//! (America/Winnipeg) stopped falling back on 2026-11-01 and stay on
//! UTC-07, -06 and -05 all year.
//! chrono-tz stopped shipping tz releases after 2025b, so it kept them on the old
//! winter offsets. jiff-tzdb follows every tz release and is compiled into the
//! binary, so a host's own (possibly older) zoneinfo never decides a time.
//! `cargo update -p jiff-tzdb` takes in a new tz release; `TZDB_VERSION` says
//! which one is bundled.
//!
//! `Tz` implements chrono's `TimeZone`, so dates stay chrono values everywhere.

use std::collections::HashSet;
use std::fmt;
use std::str::FromStr;
use std::sync::{LazyLock, Mutex};

use chrono::{
    Datelike, FixedOffset, MappedLocalTime, NaiveDate, NaiveDateTime, NaiveTime, Offset, TimeZone,
    Timelike,
};

/// The tz release the binary carries, such as "2026e".
pub fn tzdb_version() -> Option<&'static str> {
    jiff_tzdb::VERSION
}

/// An IANA zone such as `America/Vancouver`.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Tz(&'static str);

impl Tz {
    pub const UTC: Tz = Tz("UTC");
    pub const AMERICA_TORONTO: Tz = Tz("America/Toronto");

    /// The zone's IANA name, as it was parsed.
    pub fn name(&self) -> &'static str {
        self.0
    }

    fn rules(&self) -> jiff::tz::TimeZone {
        jiff::tz::db()
            .get(self.0)
            .expect("a parsed zone is in the bundled tz database")
    }
}

impl fmt::Debug for Tz {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl fmt::Display for Tz {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

/// A name the tz database does not have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownZone(pub String);

impl fmt::Display for UnknownZone {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown time zone {:?}", self.0)
    }
}

impl std::error::Error for UnknownZone {}

/// Every zone name parsed so far, kept for the life of the process so `Tz`
/// stays `Copy`; there are only a few hundred names.
static NAMES: LazyLock<Mutex<HashSet<&'static str>>> =
    LazyLock::new(|| Mutex::new(HashSet::from([Tz::UTC.0, Tz::AMERICA_TORONTO.0])));

impl FromStr for Tz {
    type Err = UnknownZone;

    /// An exact IANA name (the database's own lookup ignores case; chrono-tz did not).
    fn from_str(name: &str) -> Result<Self, Self::Err> {
        let known = jiff::tz::db()
            .get(name)
            .ok()
            .is_some_and(|zone| zone.iana_name() == Some(name));
        if !known {
            return Err(UnknownZone(name.to_owned()));
        }
        let mut names = NAMES.lock().expect("zone names lock");
        if let Some(interned) = names.get(name) {
            return Ok(Tz(interned));
        }
        let interned: &'static str = Box::leak(name.to_owned().into_boxed_str());
        names.insert(interned);
        Ok(Tz(interned))
    }
}

/// A zone's offset at one instant, remembering the zone (`DateTime<Tz>`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct TzOffset {
    zone: Tz,
    fixed: FixedOffset,
}

impl Offset for TzOffset {
    fn fix(&self) -> FixedOffset {
        self.fixed
    }
}

impl fmt::Debug for TzOffset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.fixed, self.zone)
    }
}

impl fmt::Display for TzOffset {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.fixed, f)
    }
}

impl TzOffset {
    fn new(zone: Tz, offset: jiff::tz::Offset) -> Self {
        let fixed = FixedOffset::east_opt(offset.seconds()).expect("tz offsets are under a day");
        TzOffset { zone, fixed }
    }
}

impl TimeZone for Tz {
    type Offset = TzOffset;

    fn from_offset(offset: &TzOffset) -> Self {
        offset.zone
    }

    /// The offset at the day's first moment.
    fn offset_from_local_date(&self, local: &NaiveDate) -> MappedLocalTime<TzOffset> {
        self.offset_from_local_datetime(&local.and_time(NaiveTime::MIN))
    }

    /// `Single` normally, `Ambiguous` (earlier instant first) in a repeated
    /// hour and `None` in a skipped one.
    fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> MappedLocalTime<TzOffset> {
        let Some(civil) = civil(local) else {
            return MappedLocalTime::None;
        };
        match self.rules().to_ambiguous_timestamp(civil).offset() {
            jiff::tz::AmbiguousOffset::Unambiguous { offset } => {
                MappedLocalTime::Single(TzOffset::new(*self, offset))
            }
            jiff::tz::AmbiguousOffset::Fold { before, after } => MappedLocalTime::Ambiguous(
                TzOffset::new(*self, before),
                TzOffset::new(*self, after),
            ),
            jiff::tz::AmbiguousOffset::Gap { .. } => MappedLocalTime::None,
        }
    }

    fn offset_from_utc_date(&self, utc: &NaiveDate) -> TzOffset {
        self.offset_from_utc_datetime(&utc.and_time(NaiveTime::MIN))
    }

    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> TzOffset {
        let utc = utc.and_utc();
        let at = jiff::Timestamp::new(utc.timestamp(), utc.timestamp_subsec_nanos() as i32)
            .expect("chrono's range fits jiff's");
        TzOffset::new(*self, self.rules().to_offset(at))
    }
}

/// jiff's civil time for a chrono wall time; `None` beyond jiff's years
/// (-9999 to 9999), which no event reaches.
fn civil(local: &NaiveDateTime) -> Option<jiff::civil::DateTime> {
    jiff::civil::DateTime::new(
        i16::try_from(local.year()).ok()?,
        local.month() as i8,
        local.day() as i8,
        local.hour() as i8,
        local.minute() as i8,
        // A leap second reads as the second before it.
        local.second().min(59) as i8,
        (local.nanosecond() % 1_000_000_000) as i32,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};

    use super::*;

    fn at(text: &str) -> DateTime<Utc> {
        text.parse().unwrap()
    }

    fn wall(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").unwrap()
    }

    fn zone(name: &str) -> Tz {
        name.parse().unwrap()
    }

    #[test]
    fn the_bundled_database_knows_canadas_2026_changes() {
        // 2026e moved Manitoba to permanent -05; every later release keeps it.
        assert!(tzdb_version().unwrap() >= "2026e");
    }

    #[test]
    fn british_columbia_stays_on_utc_minus_seven_after_november_2026() {
        let vancouver = zone("America/Vancouver");
        // UBC Symphony Orchestra, Nov 6 2026, 7:30-9:30 PM.
        assert_eq!(
            at("2026-11-07T02:30:00Z")
                .with_timezone(&vancouver)
                .format("%Y-%m-%d %H:%M")
                .to_string(),
            "2026-11-06 19:30"
        );
        assert_eq!(
            vancouver
                .from_local_datetime(&wall("2026-11-06 19:30"))
                .single()
                .unwrap()
                .with_timezone(&Utc),
            at("2026-11-07T02:30:00Z")
        );
        // No fall-back hour repeats, and the next spring has no gap.
        assert!(
            vancouver
                .from_local_datetime(&wall("2026-11-01 01:30"))
                .single()
                .is_some()
        );
        assert!(
            vancouver
                .from_local_datetime(&wall("2027-03-14 02:30"))
                .single()
                .is_some()
        );
        // Before the change, summer time was already -07 and winter -08.
        assert_eq!(
            at("2026-01-15T20:00:00Z")
                .with_timezone(&vancouver)
                .offset()
                .fix(),
            FixedOffset::west_opt(8 * 3600).unwrap()
        );
    }

    #[test]
    fn alberta_and_manitoba_stay_on_their_summer_offsets_too() {
        for (name, hours) in [("America/Edmonton", 6), ("America/Winnipeg", 5)] {
            assert_eq!(
                at("2026-12-15T20:00:00Z")
                    .with_timezone(&zone(name))
                    .offset()
                    .fix(),
                FixedOffset::west_opt(hours * 3600).unwrap(),
                "{name}"
            );
        }
    }

    #[test]
    fn zones_that_still_change_keep_their_gaps_and_folds() {
        let toronto = Tz::AMERICA_TORONTO;
        assert_eq!(
            at("2026-12-15T20:00:00Z")
                .with_timezone(&toronto)
                .format("%H:%M %z")
                .to_string(),
            "15:00 -0500"
        );
        match toronto.from_local_datetime(&wall("2026-11-01 01:30")) {
            MappedLocalTime::Ambiguous(earlier, later) => {
                assert_eq!(earlier.with_timezone(&Utc), at("2026-11-01T05:30:00Z"));
                assert_eq!(later.with_timezone(&Utc), at("2026-11-01T06:30:00Z"));
            }
            other => panic!("expected a repeated hour, got {other:?}"),
        }
        assert_eq!(
            toronto.from_local_datetime(&wall("2027-03-14 02:30")),
            MappedLocalTime::None
        );
    }

    #[test]
    fn names_parse_exactly() {
        assert_eq!(zone("America/Vancouver").name(), "America/Vancouver");
        assert_eq!(zone("UTC"), Tz::UTC);
        assert_eq!(zone("America/Toronto"), Tz::AMERICA_TORONTO);
        assert!("america/vancouver".parse::<Tz>().is_err());
        assert!("Mars/Olympus_Mons".parse::<Tz>().is_err());
    }
}
