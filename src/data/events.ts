import type { Event } from "../types";

// Helper function to derive date/time/dayOfWeek from dtstart_utc
function getDateFromUTC(utcString: string): { date: string; time: string; dayOfWeek: string; eventDate: Date } {
  const date = new Date(utcString);
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  
  // Format time in 12-hour format
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeStr = minutes > 0 
    ? `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`
    : `${displayHours} ${ampm}`;
  
  return { date: dateStr, time: timeStr, dayOfWeek, eventDate: date };
}

// Helper function to format time range from dtstart_utc and dtend_utc
function getTimeRange(dtstart_utc: string, dtend_utc: string): string {
  const start = new Date(dtstart_utc);
  const end = new Date(dtend_utc);
  
  const formatTime = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return minutes > 0 
      ? `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`
      : `${displayHours} ${ampm}`;
  };
  
  return `${formatTime(start)} - ${formatTime(end)}`;
}

// Helper to map club_type to category
function getCategoryFromClubType(club_type?: string): string {
  const mapping: Record<string, string> = {
    'WUSA': 'Social & Games',
    'Athletics': 'Athletics',
    'Student Society': 'Academic',
  };
  return club_type ? (mapping[club_type] || 'Events') : 'Events';
}

export const mockEvents: Event[] = [
  {
    id: 3733,
    title: "UWMUN Events",
    description: "UWMUN is back and better than ever for the winter term! Come on down for our start of term training session and learn all the ins and outs of Model UN!\n\n(Condensed from multiple events)",
    location: "HH 138",
    dtstart_utc: "2026-01-27T23:00:00Z",
    dtend_utc: "2026-01-28T01:30:00Z",
    price: null,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/edb6870c-9ba1-452a-bcef-92b3577341b1.jpg",
    club_type: "WUSA",
    added_at: "2026-01-17T20:32:26.142684Z",
    school: "University of Waterloo",
    source_url: "https://www.instagram.com/p/DToBKUxke-2/",
    ig_handle: "uwmun",
    discord_handle: null,
    x_handle: null,
    tiktok_handle: null,
    fb_handle: null,
    other_handle: null,
    display_handle: "uwmun",
  },
  {
    id: 3531,
    title: "Revival 2026",
    description: "✨A love story told through movement✨ Introducing UW Dhamaka's Competitive Team for Revival 2026.",
    location: "P.C. Ho Theatre (5183 Sheppard Ave E, Scarborough, ON M1B 5Z5)",
    dtstart_utc: "2026-01-17T17:00:00Z",
    dtend_utc: "2026-01-17T20:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/e499a7b2-b1af-4a60-ac18-f917e71494da.jpg",
    club_type: "WUSA",
    added_at: "2026-01-07T20:58:02.924Z",
    school: "University of Waterloo",
    display_handle: "uw.dhamaka",
  },
  {
    id: 3683,
    title: "Band Networking",
    description: "Event for anyone who wants to join a band or meet new people to play music with!",
    location: "RCH 110",
    dtstart_utc: "2026-01-17T17:00:00Z",
    dtend_utc: "2026-01-17T21:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/a4447100-3a61-4840-b506-b4f0fb79376a.jpg",
    club_type: "WUSA",
    added_at: "2026-01-15T20:08:38.554Z",
    school: "University of Waterloo",
    display_handle: "jamnetwork_uw",
  },
  {
    id: 3568,
    title: "Professional Photoshoots",
    description: "Professional Photoshoots hosted by EngSoc.",
    location: "E5 Bridge",
    dtstart_utc: "2026-01-17T17:30:00Z",
    dtend_utc: "2026-01-17T20:30:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/f3fecf0c-8758-41da-a967-f34c6569fd52.jpg",
    club_type: "Student Society",
    added_at: "2026-01-09T05:51:57.910Z",
    school: "University of Waterloo",
    display_handle: "uwengsoc",
  },
  {
    id: 3727,
    title: "Welcome Meeting",
    description: "Hello and welcome to all the new people who joined during club fair!",
    location: "MC 4064",
    dtstart_utc: "2026-01-17T18:00:00Z",
    dtend_utc: "2026-01-17T23:00:00Z",
    price: 0,
    food: ["Crispy cream donuts"],
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/11dcb5f1-b5a2-464a-84f5-fcb4a5aa6ea2.jpg",
    club_type: "WUSA",
    added_at: "2026-01-17T05:18:16.115Z",
    school: "University of Waterloo",
    display_handle: "uwyugioh",
  },
  {
    id: 3677,
    title: "Try-It Session",
    description: "Come have fun! All skill levels welcome!",
    location: "PAC 3rd Floor, North",
    dtstart_utc: "2026-01-17T19:00:00Z",
    dtend_utc: "2026-01-17T21:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/9dac4b13-32f6-417b-8357-942971f464e0.jpg",
    club_type: "Athletics",
    added_at: "2026-01-15T16:00:53.602Z",
    school: "University of Waterloo",
    display_handle: "uwaterloottc",
  },
  {
    id: 3675,
    title: "Kingdom Come Weekly Events",
    description: "New year, new chances to Connect.",
    location: "SLC 2134/2135",
    dtstart_utc: "2026-01-17T20:00:00Z",
    dtend_utc: "2026-01-17T20:00:00Z",
    price: 0,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/013c95ac-eab9-4a15-8d5d-c0d9eb8d1ebe.jpg",
    club_type: "WUSA",
    added_at: "2026-01-15T14:39:01.410Z",
    school: "University of Waterloo",
    display_handle: "kc_waterloo",
  },
  {
    id: 3619,
    title: "Contemporary Combo",
    description: "Contemporary combo with Anastasia and Jessica in PAC Studio 1!",
    location: "PAC Studio 1",
    dtstart_utc: "2026-01-17T21:00:00Z",
    dtend_utc: "2026-01-17T22:00:00Z",
    price: 10,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/16e47d66-6615-45b7-8d91-29229b29b762.jpg",
    club_type: "WUSA",
    added_at: "2026-01-12T22:40:19.255Z",
    school: "University of Waterloo",
    display_handle: "uwaterloodance",
  },
  {
    id: 3653,
    title: "BOT Try-It",
    description: "Interested in climbing for the first time? Come to our BOT try-it event!",
    location: "PAC Climbing Wall",
    dtstart_utc: "2026-01-17T21:30:00Z",
    dtend_utc: "2026-01-17T23:30:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/2cda50ef-a64d-4030-87d9-197303733626.jpg",
    club_type: "Athletics",
    added_at: "2026-01-14T21:06:52.436Z",
    school: "University of Waterloo",
    display_handle: "wlooclimbingclub",
  },
  {
    id: 3571,
    title: "Open Editorial Photoshoot",
    description: "Get your photos professionally taken at a fee of $5.",
    location: "RCH 308",
    dtstart_utc: "2026-01-17T22:00:00Z",
    dtend_utc: "2026-01-18T01:00:00Z",
    price: 5,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/5297b28c-290b-4ccf-832f-65cb8f18c869.jpg",
    club_type: "WUSA",
    added_at: "2026-01-15T22:51:23.790Z",
    school: "University of Waterloo",
    display_handle: "fashionforchange",
  },
  {
    id: 3682,
    title: "Board Game And Puzzle Night",
    description: "Meet other readers, unwind, and get to know the club!",
    location: "RCH 205",
    dtstart_utc: "2026-01-17T22:00:00Z",
    dtend_utc: "2026-01-18T01:00:00Z",
    price: 0,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/99a80dd8-1a25-4c1c-b3af-ed889b8e1f31.jpg",
    club_type: "WUSA",
    added_at: "2026-01-15T18:51:35.008Z",
    school: "University of Waterloo",
    display_handle: "uwtrgbookclub",
  },
  {
    id: 3574,
    title: "Board Game Night",
    description: "Meet new friends and enjoy some friendly competition!",
    location: "RCH 207",
    dtstart_utc: "2026-01-17T23:00:00Z",
    dtend_utc: "2026-01-18T03:00:00Z",
    price: 0,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/6123b758-2087-48d5-ad63-c79cd53c1e8e.jpg",
    club_type: "WUSA",
    added_at: "2026-01-09T20:09:38.568Z",
    school: "University of Waterloo",
    display_handle: "uwboardgames",
  },
  {
    id: 3625,
    title: "Beginner-Friendly D&D One-Shot",
    description: "Wild west themed Beginner-Friendly D&D One-Shot.",
    location: "MC 2035",
    dtstart_utc: "2026-01-17T23:00:00Z",
    dtend_utc: "2026-01-17T23:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "",
    club_type: "WUSA",
    added_at: "2026-01-13T16:00:17.169Z",
    school: "University of Waterloo",
    display_handle: "uwatsfic",
  },
  {
    id: 3640,
    title: "Competitive Esports Tryouts",
    description: "Recruiting for Overwatch 2 and Marvel Rivals teams.",
    location: "Online/MC",
    dtstart_utc: "2026-01-17T23:00:00Z",
    dtend_utc: "2026-01-18T01:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/88dca4e6-c63e-47cb-be08-4fe5cf6843ad.jpg",
    club_type: "Athletics",
    added_at: "2026-01-13T22:38:15.207Z",
    school: "University of Waterloo",
    display_handle: "uwaterloogg",
  },
  {
    id: 3547,
    title: "WaterLAN 2026",
    description: "UWaterloo Smash Club and Condors Esports SSBU tournament.",
    location: "University of Waterloo",
    dtstart_utc: "2026-01-18T05:00:00Z",
    dtend_utc: "2026-01-19T05:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/b47b59c8-3fc3-46ae-8166-36cb4444aea3.jpg",
    club_type: "Athletics",
    added_at: "2026-01-09T05:05:11.728Z",
    school: "University of Waterloo",
    display_handle: "uwaterloogg",
  },
  {
    id: 3646,
    title: "Instructor Showcase",
    description: "Experience mini classes of both Sanda and Wushu for FREE!",
    location: "CIF Studio",
    dtstart_utc: "2026-01-18T18:45:00Z",
    dtend_utc: "2026-01-18T21:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/55b664c1-a9a5-4e66-a79e-e6ef86c17576.jpg",
    club_type: "Athletics",
    added_at: "2026-01-14T14:34:57.087Z",
    school: "University of Waterloo",
    display_handle: "wloochinesemartialarts",
  },
  {
    id: 3578,
    title: "AFCON Finals Watch Party",
    description: "Africa's biggest night deserves the biggest community.",
    location: "MC 2017",
    dtstart_utc: "2026-01-18T19:00:00Z",
    dtend_utc: "2026-01-18T19:00:00Z",
    price: 0,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/4710a030-e47d-4285-a029-dbbd747a7eae.jpg",
    club_type: "WUSA",
    added_at: "2026-01-15T23:57:18.174Z",
    school: "University of Waterloo",
    display_handle: "nasawaterloo",
  },
  {
    id: 3698,
    title: "Volleyball Tournament",
    description: "Check out the Volleyball tournament! Registration closes soon!",
    location: "PAC Small Gym",
    dtstart_utc: "2026-01-18T19:00:00Z",
    dtend_utc: "2026-01-18T23:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/9cb7b21f-cf0f-444b-b397-95ad4760644c.jpg",
    club_type: "Student Society",
    added_at: "2026-01-16T02:21:23.361Z",
    school: "University of Waterloo",
    display_handle: "uwengsoc",
  },
  {
    id: 3617,
    title: "Table Tennis Club Sessions",
    description: "Join the TTC this term! Sessions start Sunday.",
    location: "PAC Activity Area, 3rd Floor",
    dtstart_utc: "2026-01-18T19:30:00Z",
    dtend_utc: "2026-01-18T22:00:00Z",
    price: 0,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/d327d1f8-dacb-44f8-8d4b-9c257180d228.jpg",
    club_type: "Athletics",
    added_at: "2026-01-12T20:14:11.543Z",
    school: "University of Waterloo",
    display_handle: "uwaterloottc",
  },
  {
    id: 3702,
    title: "Sunday Classes",
    description: "Ballroom dance classes start this Sunday in PAC Studio 1.",
    location: "PAC Studio 1",
    dtstart_utc: "2026-01-18T20:00:00Z",
    dtend_utc: "2026-01-18T21:00:00Z",
    price: 50,
    food: null,
    registration: true,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/a393098e-1ee7-4ff5-b35b-4063288ffab8.jpg",
    club_type: "WUSA",
    added_at: "2026-01-16T16:13:22.987Z",
    school: "University of Waterloo",
    display_handle: "uwballroom",
  },
  {
    id: 3580,
    title: "Dragon Boat Training",
    description: "First practice of the term! Try It Month runs for all of January.",
    location: "PAC Pool",
    dtstart_utc: "2026-01-18T22:30:00Z",
    dtend_utc: "2026-01-19T00:30:00Z",
    price: 0,
    food: null,
    registration: false,
    source_image_url: "https://bug-free-octo-spork.s3.us-east-2.amazonaws.com/events/e6b3089f-729d-4e72-bc6f-53dae8cb5b39.jpg",
    club_type: "Athletics",
    added_at: "2026-01-10T02:01:38.314Z",
    school: "University of Waterloo",
    display_handle: "wloo.dboat",
  },
].map((eventRaw): Event => {
  const event = eventRaw as Record<string, unknown>;
  // Transform new format to include computed fields for backward compatibility
  if (event.dtstart_utc) {
    const dateInfo = getDateFromUTC(event.dtstart_utc as string);
    const timeRange = event.dtend_utc 
      ? getTimeRange(event.dtstart_utc as string, event.dtend_utc as string)
      : dateInfo.time;
    
    return {
      ...event,
      // Computed fields for backward compatibility
      date: dateInfo.date,
      time: timeRange,
      dayOfWeek: dateInfo.dayOfWeek,
      eventDate: dateInfo.eventDate,
      // Map fields
      category: (event.category as string | undefined) || getCategoryFromClubType(event.club_type as string | undefined),
      organization: (event.organization as string | undefined) || (event.display_handle as string | undefined) || '',
      requiresRegistration: event.requiresRegistration ?? event.registration ?? false,
      isLive: event.isLive ?? true,
      food: event.food || [],
      price: event.price ?? 0,
      imageUrl: event.imageUrl || event.source_image_url,
      addedDate: event.addedDate || (event.added_at ? new Date(event.added_at as string) : new Date()),
    } as Event;
  }
  return event as unknown as Event;
});

// Filter options
export const availableCategories = [
  "Events",
  "Clubs",
  "Academic",
  "Religious",
  "Cultural",
  "Social & Games",
  "Sports",
  "Career",
];

export const availableLocations = [
  "LAX",
  "Pollock",
  "TCF 1",
  "SLC",
  "Student Union",
  "Library",
  "Gym",
];

export const availableFoods = [
  "Snacks",
  "Pizza",
  "Sandwiches",
  "Salad",
  "Dessert",
  "Drinks",
  "Vegan",
  "Gluten-free",
];

export const availableDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const availableSchools = [
  "University of Waterloo",
  "University of Toronto",
  "McGill University",
  "University of British Columbia",
  "McMaster University",
];
