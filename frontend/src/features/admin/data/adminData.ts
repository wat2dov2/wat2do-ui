import type { EventSubmission, ReportedEvent, ScrapedEvent } from "@/shared/types";

// Mock event submissions
export const mockEventSubmissions: EventSubmission[] = [
  {
    id: "sub-1",
    eventData: {
      title: "AI Workshop: Building Your First Chatbot",
      description: "Learn the fundamentals of AI and build your first chatbot using Python and OpenAI.",
      date: "2024-02-15",
      time: "14:00",
      location: "DC 1301",
      category: "Technology",
      price: 0,
      food: ["Pizza", "Drinks"],
      requiresRegistration: true,
      organization: "AI Club",
    },
    submittedBy: "student1@uwaterloo.ca",
    submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    status: "pending",
  },
  {
    id: "sub-2",
    eventData: {
      title: "Hackathon 2024",
      description: "24-hour coding competition with prizes and free food!",
      date: "2024-02-20",
      time: "10:00",
      location: "MC 2066",
      category: "Technology",
      price: 5,
      food: ["Pizza", "Energy Drinks", "Snacks"],
      requiresRegistration: true,
      organization: "CS Club",
    },
    submittedBy: "student2@uwaterloo.ca",
    submittedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
    status: "pending",
  },
  {
    id: "sub-3",
    eventData: {
      title: "Yoga & Meditation Session",
      description: "Relax and unwind with a guided yoga and meditation session.",
      date: "2024-02-12",
      time: "18:00",
      location: "PAC 2001",
      category: "Health & Wellness",
      price: 0,
      food: [],
      requiresRegistration: false,
      organization: "Wellness Club",
    },
    submittedBy: "student3@uwaterloo.ca",
    submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    status: "approved",
  },
  {
    id: "sub-4",
    eventData: {
      title: "Networking Mixer",
      description: "Connect with industry professionals and fellow students.",
      date: "2024-02-18",
      time: "17:00",
      location: "SLC Great Hall",
      category: "Career",
      price: 10,
      food: ["Appetizers", "Wine"],
      requiresRegistration: true,
      organization: "Business Club",
    },
    submittedBy: "student4@uwaterloo.ca",
    submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    status: "rejected",
  },
];

// Mock reported events
export const mockReportedEvents: ReportedEvent[] = [
  {
    id: "report-1",
    eventId: 1,
    reportedBy: "user1@uwaterloo.ca",
    reportedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    reason: "Inappropriate content",
    status: "pending",
  },
  {
    id: "report-2",
    eventId: 5,
    reportedBy: "user2@uwaterloo.ca",
    reportedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    reason: "Spam or misleading information",
    status: "pending",
  },
  {
    id: "report-3",
    eventId: 3,
    reportedBy: "user3@uwaterloo.ca",
    reportedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    reason: "Duplicate event",
    status: "resolved",
  },
];

// Mock scraped events - using actual event IDs from mockEvents
export const mockScrapedEvents: ScrapedEvent[] = [
  {
    id: "scrap-1",
    eventId: 3733,
    scrapedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    source: "web-scraper",
  },
  {
    id: "scrap-2",
    eventId: 3531,
    scrapedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
    source: "web-scraper",
  },
  {
    id: "scrap-3",
    eventId: 3683,
    scrapedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    source: "web-scraper",
  },
  {
    id: "scrap-4",
    eventId: 3568,
    scrapedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
    source: "web-scraper",
  },
];

// Note: All data operations (get, save, update, delete) have been moved to
// src/features/admin/api/admin.api.ts
// This file now only contains mock data for the admin feature.
