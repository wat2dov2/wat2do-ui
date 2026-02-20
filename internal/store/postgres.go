package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"wat2do-ui/backend/internal/domain"
)

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() {
	s.pool.Close()
}

func (s *PostgresStore) ListEvents(ctx context.Context, limit, offset int) ([]domain.Event, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, category, organization, location, dtstart_utc, dtend_utc,
		       food, price, registration, description, source_image_url, club_type,
		       school, source_url, ig_handle, discord_handle, x_handle,
		       tiktok_handle, fb_handle, other_handle, display_handle,
		       scraped_at, scraper_source, scraper_run_id, created_at
		FROM public.events
		ORDER BY dtstart_utc ASC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]domain.Event, 0)
	for rows.Next() {
		var e domain.Event
		if err := rows.Scan(
			&e.ID, &e.Title, &e.Category, &e.Organization, &e.Location,
			&e.DTStartUTC, &e.DTEndUTC, &e.Food, &e.Price, &e.Registration,
			&e.Description, &e.SourceImageURL, &e.ClubType, &e.School,
			&e.SourceURL, &e.IGHandle, &e.DiscordHandle, &e.XHandle,
			&e.TikTokHandle, &e.FBHandle, &e.OtherHandle, &e.DisplayHandle,
			&e.ScrapedAt, &e.ScraperSource, &e.ScraperRunID, &e.CreatedAt,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}

	return events, rows.Err()
}

func (s *PostgresStore) CreateEvent(ctx context.Context, req domain.CreateEventRequest) (domain.Event, error) {
	var e domain.Event
	err := s.pool.QueryRow(ctx, `
		INSERT INTO public.events (
			title, category, organization, location, dtstart_utc, dtend_utc, food,
			price, registration, description, source_image_url, club_type, school,
			source_url, ig_handle, discord_handle, x_handle, tiktok_handle,
			fb_handle, other_handle, display_handle, scraped_at, scraper_source,
			scraper_run_id
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
		)
		RETURNING id, title, category, organization, location, dtstart_utc, dtend_utc,
		       food, price, registration, description, source_image_url, club_type,
		       school, source_url, ig_handle, discord_handle, x_handle,
		       tiktok_handle, fb_handle, other_handle, display_handle,
		       scraped_at, scraper_source, scraper_run_id, created_at
	`,
		req.Title,
		req.Category,
		req.Organization,
		req.Location,
		req.DTStartUTC,
		req.DTEndUTC,
		req.Food,
		req.Price,
		req.Registration,
		req.Description,
		req.SourceImageURL,
		req.ClubType,
		req.School,
		req.SourceURL,
		req.IGHandle,
		req.DiscordHandle,
		req.XHandle,
		req.TikTokHandle,
		req.FBHandle,
		req.OtherHandle,
		req.DisplayHandle,
		req.ScrapingMetadata.ScrapedAt,
		req.ScrapingMetadata.ScraperSource,
		req.ScrapingMetadata.ScraperRunID,
	).Scan(
		&e.ID, &e.Title, &e.Category, &e.Organization, &e.Location,
		&e.DTStartUTC, &e.DTEndUTC, &e.Food, &e.Price, &e.Registration,
		&e.Description, &e.SourceImageURL, &e.ClubType, &e.School,
		&e.SourceURL, &e.IGHandle, &e.DiscordHandle, &e.XHandle,
		&e.TikTokHandle, &e.FBHandle, &e.OtherHandle, &e.DisplayHandle,
		&e.ScrapedAt, &e.ScraperSource, &e.ScraperRunID, &e.CreatedAt,
	)

	return e, err
}

func (s *PostgresStore) ListClubs(ctx context.Context) ([]domain.Club, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, club_name, categories, club_page, ig, discord, club_type
		FROM public.clubs
		ORDER BY club_name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clubs := make([]domain.Club, 0)
	for rows.Next() {
		var c domain.Club
		if err := rows.Scan(&c.ID, &c.ClubName, &c.Categories, &c.ClubPage, &c.IG, &c.Discord, &c.ClubType); err != nil {
			return nil, err
		}
		clubs = append(clubs, c)
	}

	return clubs, rows.Err()
}
