package event

import "context"

type Repository interface {
	List(ctx context.Context, filter Filter) ([]Event, int, error)
	GetByID(ctx context.Context, id string) (*Event, error)
	Create(ctx context.Context, event *Event) error
	Update(ctx context.Context, event *Event) error
	Delete(ctx context.Context, id string) error
}
