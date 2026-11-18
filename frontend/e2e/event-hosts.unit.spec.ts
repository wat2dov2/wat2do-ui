import { expect, test } from "@playwright/test";
import { clubsHostEvent, eventHostClubIds } from "../src/shared/utils/event";

const cohost = (id: number) => ({ id, club_name: `Club ${id}`, logo_url: null });

test("an event's hosts are its own club, then its cohosts", () => {
  expect(eventHostClubIds({ club_id: 1, cohosts: [cohost(2), cohost(3)] })).toEqual([1, 2, 3]);
  expect(eventHostClubIds({ club_id: 1 })).toEqual([1]);
  // A cohosted event whose own club was removed is still hosted by its cohosts.
  expect(eventHostClubIds({ club_id: null, cohosts: [cohost(2)] })).toEqual([2]);
  expect(eventHostClubIds({ club_id: null })).toEqual([]);
});

test("Going is off for the team of the event's club or a cohost, and for no one else", () => {
  const event = { club_id: 1, cohosts: [cohost(2)] };
  // On the hosting club's team, or a cohost's, among other clubs.
  expect(clubsHostEvent([{ id: 1 }], event)).toBe(true);
  expect(clubsHostEvent([{ id: 9 }, { id: 2 }], event)).toBe(true);
  // On other clubs' teams only.
  expect(clubsHostEvent([{ id: 3 }], event)).toBe(false);
  // Signed out, or on no club's team.
  expect(clubsHostEvent([], event)).toBe(false);
  // An event without a club is no one's to run.
  expect(clubsHostEvent([{ id: 1 }], { club_id: null })).toBe(false);
});
