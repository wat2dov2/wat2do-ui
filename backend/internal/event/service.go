package event

import (
	"context"

	"campus-events/backend/internal/platform"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, filter Filter) ([]Event, int, error) {
	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Limit > 100 {
		filter.Limit = 100
	}
	return s.repo.List(ctx, filter)
}

func (s *Service) GetByID(ctx context.Context, id string) (*Event, error) {
	if id == "" {
		return nil, platform.ErrValidation
	}
	return s.repo.GetByID(ctx, id)
}

func (s *Service) Create(ctx context.Context, e *Event) error {
	if err := validateEvent(e); err != nil {
		return err
	}
	e.Status = "draft"
	return s.repo.Create(ctx, e)
}

func (s *Service) Update(ctx context.Context, e *Event) error {
	existing, err := s.repo.GetByID(ctx, e.ID)
	if err != nil {
		return err
	}

	existing.Title = e.Title
	existing.Description = e.Description
	existing.Category = e.Category
	existing.Location = e.Location
	existing.StartTime = e.StartTime
	existing.EndTime = e.EndTime
	existing.IsFree = e.IsFree
	existing.Price = e.Price
	existing.Capacity = e.Capacity
	existing.Tags = e.Tags
	existing.ImageURL = e.ImageURL

	return s.repo.Update(ctx, existing)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func validateEvent(e *Event) error {
	v := &platform.ValidationErrors{}

	if e.Title == "" {
		v.Add("title", "is required")
	}
	if e.StartTime.IsZero() {
		v.Add("startTime", "is required")
	}
	if e.EndTime.IsZero() {
		v.Add("endTime", "is required")
	}
	if !e.StartTime.IsZero() && !e.EndTime.IsZero() && e.EndTime.Before(e.StartTime) {
		v.Add("endTime", "must be after startTime")
	}

	if v.HasErrors() {
		return v
	}
	return nil
}
