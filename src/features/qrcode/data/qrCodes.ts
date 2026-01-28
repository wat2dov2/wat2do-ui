import type { QRCode, QRCodeScan } from "@/shared/types";

// Generate time series scan data for the past N days with realistic patterns
function generateTimeSeriesScans(
  qrCodeId: string,
  daysAgo: number,
  baseScans: number
): QRCodeScan[] {
  const scans: QRCodeScan[] = [];
  const now = new Date();
  
  // Generate scans over the past N days with realistic patterns
  // More scans on weekdays, fewer on weekends
  for (let day = daysAgo; day >= 0; day--) {
    const date = new Date(now);
    date.setDate(date.getDate() - day);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Base scans per day, reduced on weekends
    const dailyBase = Math.floor(baseScans / daysAgo);
    const weekendMultiplier = isWeekend ? 0.4 : 1.0;
    const scansToday = Math.max(0, Math.floor((dailyBase + Math.random() * 5) * weekendMultiplier));
    
    for (let i = 0; i < scansToday; i++) {
      const scanTime = new Date(date);
      // Distribute scans throughout the day (more during peak hours)
      const hour = Math.floor(Math.random() * 12) + 8; // 8 AM to 8 PM
      scanTime.setHours(hour);
      scanTime.setMinutes(Math.floor(Math.random() * 60));
      scanTime.setSeconds(Math.floor(Math.random() * 60));
      
      const sessionId = `session_${qrCodeId}_${scanTime.getTime()}_${Math.random().toString(36).substr(2, 9)}`;
      const userId = Math.random() > 0.7 ? `user_${Math.floor(Math.random() * 10)}` : undefined;
      
      scans.push({
        id: `scan_${qrCodeId}_${scanTime.getTime()}_${i}`,
        qrCodeId,
        scannedAt: scanTime.toISOString(),
        userId,
        sessionId,
        conversionActions: Math.random() > 0.85 ? ["event_saved"] : [],
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15",
      });
    }
  }
  
  return scans;
}

export const mockQRCodes: QRCode[] = [
  {
    id: "qr_mock_001",
    name: "Main Campus Entrance Poster",
    description: "Located at the main entrance of the Student Life Centre",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Social & Games", "Cultural"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster001/400/300",
    latitude: 43.4723,
    longitude: -80.5449,
  },
  {
    id: "qr_mock_002",
    name: "Engineering Building Poster",
    description: "Engineering building lobby, near the main staircase",
    destinationType: "event",
    destinationId: 3531,
    createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster002/400/300",
    latitude: 43.4705,
    longitude: -80.5432,
  },
  {
    id: "qr_mock_003",
    name: "Library Study Area Poster",
    description: "Third floor study area, near the windows",
    destinationType: "custom-url",
    destinationId: "https://example.com/events",
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster003/400/300",
    latitude: 43.4718,
    longitude: -80.5465,
  },
  {
    id: "qr_mock_004",
    name: "Cafeteria Poster",
    description: "Near the food court entrance",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Events"],
      locations: [],
      foods: ["Pizza", "Snacks"],
      days: [],
      priceRange: { min: "", max: "0" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: false,
    imageUrl: "https://picsum.photos/seed/poster004/400/300",
    latitude: 43.4735,
    longitude: -80.5421,
  },
  {
    id: "qr_mock_005",
    name: "Science Building Lobby",
    description: "Main entrance of the Science building, first floor",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Academic", "Technology"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster005/400/300",
    latitude: 43.4698,
    longitude: -80.5415,
  },
  {
    id: "qr_mock_006",
    name: "Athletic Centre Poster",
    description: "Near the gym entrance, fitness area",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Sports & Fitness"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster006/400/300",
    latitude: 43.4742,
    longitude: -80.5458,
  },
  {
    id: "qr_mock_007",
    name: "Arts Building Gallery",
    description: "Outside the art gallery, second floor",
    destinationType: "event",
    destinationId: 3531,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster007/400/300",
    latitude: 43.4712,
    longitude: -80.5442,
  },
  {
    id: "qr_mock_008",
    name: "Residence Commons",
    description: "Common area in residence building, ground floor",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Social & Games", "Cultural", "Music & Performance"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster008/400/300",
    latitude: 43.4755,
    longitude: -80.5438,
  },
  {
    id: "qr_mock_009",
    name: "Business School Entrance",
    description: "Main entrance of the Business building",
    destinationType: "custom-url",
    destinationId: "https://uwaterloo.ca/events",
    createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster009/400/300",
    latitude: 43.4689,
    longitude: -80.5428,
  },
  {
    id: "qr_mock_010",
    name: "Student Centre Food Court",
    description: "Near the Tim Hortons, food court area",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Events"],
      locations: [],
      foods: ["Coffee", "Snacks", "Pizza"],
      days: [],
      priceRange: { min: "", max: "10" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster010/400/300",
    latitude: 43.4728,
    longitude: -80.5451,
  },
  {
    id: "qr_mock_011",
    name: "Math Building Stairwell",
    description: "Third floor stairwell, near the elevators",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Academic", "Career"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster011/400/300",
    latitude: 43.4701,
    longitude: -80.5445,
  },
  {
    id: "qr_mock_012",
    name: "Campus Recreation Centre",
    description: "Main lobby, near the front desk",
    destinationType: "event",
    destinationId: 3531,
    createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster012/400/300",
    latitude: 43.4739,
    longitude: -80.5462,
  },
  {
    id: "qr_mock_013",
    name: "Health Services Building",
    description: "Ground floor waiting area",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Health & Wellness"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster013/400/300",
    latitude: 43.4715,
    longitude: -80.5471,
  },
  {
    id: "qr_mock_014",
    name: "Environment Building",
    description: "First floor, near the sustainability office",
    destinationType: "custom-url",
    destinationId: "https://uwaterloo.ca/sustainability/events",
    createdAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: false,
    imageUrl: "https://picsum.photos/seed/poster014/400/300",
    latitude: 43.4695,
    longitude: -80.5455,
  },
  {
    id: "qr_mock_015",
    name: "Dana Porter Library",
    description: "Main floor, near the information desk",
    destinationType: "events-list",
    filters: {
      searchQuery: "",
      categories: ["Academic", "Cultural", "Arts & Crafts"],
      locations: [],
      foods: [],
      days: [],
      priceRange: { min: "", max: "" },
      dateRange: "",
      addedSince: "",
      requiresRegistration: false,
    },
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    createdBy: "tonyqiu12345@gmail.com",
    isActive: true,
    imageUrl: "https://picsum.photos/seed/poster015/400/300",
    latitude: 43.4719,
    longitude: -80.5435,
  },
];

export const mockQRScans: QRCodeScan[] = [
  // Generate scans for each QR code with different patterns
  // All going back 3 months (90 days) with varying traffic levels
  ...generateTimeSeriesScans("qr_mock_001", 90, 800), // High traffic poster - ~800 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_002", 90, 500),  // Medium traffic - ~500 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_003", 90, 300), // Lower traffic - ~300 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_004", 90, 200), // Low traffic, inactive - ~200 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_005", 90, 650), // High traffic - ~650 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_006", 90, 450), // Medium-high traffic - ~450 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_007", 90, 150), // Low traffic, new poster - ~150 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_008", 90, 950), // Very high traffic - ~950 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_009", 90, 380), // Medium traffic - ~380 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_010", 90, 720), // High traffic - ~720 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_011", 90, 180), // Low traffic, new poster - ~180 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_012", 90, 420), // Medium traffic - ~420 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_013", 90, 290), // Lower-medium traffic - ~290 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_014", 90, 120), // Very low traffic, inactive - ~120 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_015", 90, 580), // Medium-high traffic - ~580 scans over 3 months
];
