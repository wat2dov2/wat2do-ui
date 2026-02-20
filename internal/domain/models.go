package domain

import "time"

type Event struct {
	ID             int64      `json:"id"`
	Title          string     `json:"title"`
	Category       *string    `json:"category,omitempty"`
	Organization   *string    `json:"organization,omitempty"`
	Location       string     `json:"location"`
	DTStartUTC     time.Time  `json:"dtstart_utc"`
	DTEndUTC       *time.Time `json:"dtend_utc,omitempty"`
	Food           []string   `json:"food,omitempty"`
	Price          *float64   `json:"price,omitempty"`
	Registration   bool       `json:"registration"`
	Description    *string    `json:"description,omitempty"`
	SourceImageURL *string    `json:"source_image_url,omitempty"`
	ClubType       *string    `json:"club_type,omitempty"`
	School         *string    `json:"school,omitempty"`
	SourceURL      *string    `json:"source_url,omitempty"`
	IGHandle       *string    `json:"ig_handle,omitempty"`
	DiscordHandle  *string    `json:"discord_handle,omitempty"`
	XHandle        *string    `json:"x_handle,omitempty"`
	TikTokHandle   *string    `json:"tiktok_handle,omitempty"`
	FBHandle       *string    `json:"fb_handle,omitempty"`
	OtherHandle    *string    `json:"other_handle,omitempty"`
	DisplayHandle  *string    `json:"display_handle,omitempty"`
	ScrapedAt      *time.Time `json:"scraped_at,omitempty"`
	ScraperSource  *string    `json:"scraper_source,omitempty"`
	ScraperRunID   *string    `json:"scraper_run_id,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

type CreateEventRequest struct {
	Title            string           `json:"title"`
	Category         *string          `json:"category,omitempty"`
	Organization     *string          `json:"organization,omitempty"`
	Location         string           `json:"location"`
	DTStartUTC       time.Time        `json:"dtstart_utc"`
	DTEndUTC         *time.Time       `json:"dtend_utc,omitempty"`
	Food             []string         `json:"food,omitempty"`
	Price            *float64         `json:"price,omitempty"`
	Registration     bool             `json:"registration"`
	Description      *string          `json:"description,omitempty"`
	SourceImageURL   *string          `json:"source_image_url,omitempty"`
	ClubType         *string          `json:"club_type,omitempty"`
	School           *string          `json:"school,omitempty"`
	SourceURL        *string          `json:"source_url,omitempty"`
	IGHandle         *string          `json:"ig_handle,omitempty"`
	DiscordHandle    *string          `json:"discord_handle,omitempty"`
	XHandle          *string          `json:"x_handle,omitempty"`
	TikTokHandle     *string          `json:"tiktok_handle,omitempty"`
	FBHandle         *string          `json:"fb_handle,omitempty"`
	OtherHandle      *string          `json:"other_handle,omitempty"`
	DisplayHandle    *string          `json:"display_handle,omitempty"`
	ScrapingMetadata ScrapingMetadata `json:"scraping_metadata"`
}

type ScrapingMetadata struct {
	ScrapedAt     time.Time `json:"scraped_at"`
	ScraperSource string    `json:"scraper_source"`
	ScraperRunID  string    `json:"scraper_run_id"`
}

type Club struct {
	ID         int64    `json:"id"`
	ClubName   string   `json:"club_name"`
	Categories []string `json:"categories"`
	ClubPage   string   `json:"club_page"`
	IG         *string  `json:"ig,omitempty"`
	Discord    *string  `json:"discord,omitempty"`
	ClubType   string   `json:"club_type"`
}
