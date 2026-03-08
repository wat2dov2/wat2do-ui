package event

import "time"

type Event struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Category    string    `json:"category"`
	Location    string    `json:"location"`
	ImageURL    string    `json:"imageUrl,omitempty"`
	StartTime   time.Time `json:"startTime"`
	EndTime     time.Time `json:"endTime"`
	OrganizerID string    `json:"organizerId"`
	ClubID      string    `json:"clubId,omitempty"`
	IsFree      bool      `json:"isFree"`
	Price       float64   `json:"price,omitempty"`
	Capacity    int       `json:"capacity,omitempty"`
	Attendees   int       `json:"attendees"`
	Tags        []string  `json:"tags,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Filter struct {
	Category  string
	Search    string
	ClubID    string
	StartFrom *time.Time
	StartTo   *time.Time
	IsFree    *bool
	Status    string
	Limit     int
	Offset    int
}
