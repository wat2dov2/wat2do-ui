package event

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"campus-events/backend/internal/platform"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func initSchema(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS events (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT,
			category TEXT,
			location TEXT,
			image_url TEXT,
			start_time TIMESTAMPTZ NOT NULL,
			end_time TIMESTAMPTZ NOT NULL,
			organizer_id TEXT,
			club_id TEXT,
			is_free BOOLEAN DEFAULT true,
			price DECIMAL(10,2) DEFAULT 0,
			capacity INT DEFAULT 0,
			attendees INT DEFAULT 0,
			tags JSONB DEFAULT '[]',
			status TEXT DEFAULT 'draft',
			created_at TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL
		)
	`)
	return err
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(ctx context.Context, databaseURL string) (*PostgresRepository, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	if err := initSchema(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}

	return &PostgresRepository{pool: pool}, nil
}

func (r *PostgresRepository) Close() {
	r.pool.Close()
}

func (r *PostgresRepository) List(ctx context.Context, filter Filter) ([]Event, int, error) {
	var args []any
	var conditions []string
	argNum := 1

	if filter.Category != "" {
		conditions = append(conditions, fmt.Sprintf("category = $%d", argNum))
		args = append(args, filter.Category)
		argNum++
	}
	if filter.ClubID != "" {
		conditions = append(conditions, fmt.Sprintf("club_id = $%d", argNum))
		args = append(args, filter.ClubID)
		argNum++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argNum))
		args = append(args, filter.Status)
		argNum++
	}
	if filter.Search != "" {
		conditions = append(conditions, fmt.Sprintf("title ILIKE $%d", argNum))
		args = append(args, "%"+filter.Search+"%")
		argNum++
	}
	if filter.IsFree != nil {
		conditions = append(conditions, fmt.Sprintf("is_free = $%d", argNum))
		args = append(args, *filter.IsFree)
		argNum++
	}
	if filter.StartFrom != nil {
		conditions = append(conditions, fmt.Sprintf("start_time >= $%d", argNum))
		args = append(args, *filter.StartFrom)
		argNum++
	}
	if filter.StartTo != nil {
		conditions = append(conditions, fmt.Sprintf("start_time <= $%d", argNum))
		args = append(args, *filter.StartTo)
		argNum++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM events %s", where)
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	args = append(args, limit, offset)
	query := fmt.Sprintf(`
		SELECT id, title, description, category, location, image_url,
			start_time, end_time, organizer_id, club_id, is_free, price,
			capacity, attendees, tags, status, created_at, updated_at
		FROM events %s
		ORDER BY start_time ASC
		LIMIT $%d OFFSET $%d
	`, where, argNum, argNum+1)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var evt Event
		var tagsJSON []byte
		if err := rows.Scan(
			&evt.ID, &evt.Title, &evt.Description, &evt.Category, &evt.Location,
			&evt.ImageURL, &evt.StartTime, &evt.EndTime, &evt.OrganizerID,
			&evt.ClubID, &evt.IsFree, &evt.Price, &evt.Capacity, &evt.Attendees,
			&tagsJSON, &evt.Status, &evt.CreatedAt, &evt.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		if len(tagsJSON) > 0 {
			_ = json.Unmarshal(tagsJSON, &evt.Tags)
		}
		events = append(events, evt)
	}

	return events, total, rows.Err()
}

func (r *PostgresRepository) GetByID(ctx context.Context, id string) (*Event, error) {
	var evt Event
	var tagsJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT id, title, description, category, location, image_url,
			start_time, end_time, organizer_id, club_id, is_free, price,
			capacity, attendees, tags, status, created_at, updated_at
		FROM events WHERE id = $1
	`, id).Scan(
		&evt.ID, &evt.Title, &evt.Description, &evt.Category, &evt.Location,
		&evt.ImageURL, &evt.StartTime, &evt.EndTime, &evt.OrganizerID,
		&evt.ClubID, &evt.IsFree, &evt.Price, &evt.Capacity, &evt.Attendees,
		&tagsJSON, &evt.Status, &evt.CreatedAt, &evt.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, platform.ErrNotFound
		}
		return nil, err
	}
	if len(tagsJSON) > 0 {
		_ = json.Unmarshal(tagsJSON, &evt.Tags)
	}
	return &evt, nil
}

func (r *PostgresRepository) Create(ctx context.Context, evt *Event) error {
	now := time.Now()
	if evt.ID == "" {
		evt.ID = fmt.Sprintf("evt_%d", now.UnixNano()/1000)
	}
	if evt.CreatedAt.IsZero() {
		evt.CreatedAt = now
	}
	if evt.UpdatedAt.IsZero() {
		evt.UpdatedAt = now
	}
	tagsJSON, _ := json.Marshal(evt.Tags)
	if tagsJSON == nil {
		tagsJSON = []byte("[]")
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO events (
			id, title, description, category, location, image_url,
			start_time, end_time, organizer_id, club_id, is_free, price,
			capacity, attendees, tags, status, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
	`,
		evt.ID, evt.Title, evt.Description, evt.Category, evt.Location,
		evt.ImageURL, evt.StartTime, evt.EndTime, evt.OrganizerID,
		evt.ClubID, evt.IsFree, evt.Price, evt.Capacity, evt.Attendees,
		tagsJSON, evt.Status, evt.CreatedAt, evt.UpdatedAt,
	)
	return err
}

func (r *PostgresRepository) Update(ctx context.Context, evt *Event) error {
	tagsJSON, _ := json.Marshal(evt.Tags)
	if tagsJSON == nil {
		tagsJSON = []byte("[]")
	}

	res, err := r.pool.Exec(ctx, `
		UPDATE events SET
			title = $2, description = $3, category = $4, location = $5,
			image_url = $6, start_time = $7, end_time = $8, organizer_id = $9,
			club_id = $10, is_free = $11, price = $12, capacity = $13,
			attendees = $14, tags = $15, status = $16, updated_at = $17
		WHERE id = $1
	`,
		evt.ID, evt.Title, evt.Description, evt.Category, evt.Location,
		evt.ImageURL, evt.StartTime, evt.EndTime, evt.OrganizerID,
		evt.ClubID, evt.IsFree, evt.Price, evt.Capacity, evt.Attendees,
		tagsJSON, evt.Status, evt.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return platform.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) Delete(ctx context.Context, id string) error {
	res, err := r.pool.Exec(ctx, `DELETE FROM events WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return platform.ErrNotFound
	}
	return nil
}
