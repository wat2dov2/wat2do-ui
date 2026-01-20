import type { QRCode, QRCodeScan } from "@/types";

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
    latitude: 43.4735,
    longitude: -80.5421,
  },
];

export const mockQRScans: QRCodeScan[] = [
  // Generate scans for each QR code with different patterns
  // All going back 3 months (90 days) with varying traffic levels
  ...generateTimeSeriesScans("qr_mock_001", 90, 800), // High traffic poster - ~800 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_002", 90, 500),  // Medium traffic - ~500 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_003", 90, 300), // Lower traffic - ~300 scans over 3 months
  ...generateTimeSeriesScans("qr_mock_004", 90, 200), // Low traffic, inactive - ~200 scans over 3 months
];
