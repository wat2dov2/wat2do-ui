package club

import "context"

type Repository interface {
	List(ctx context.Context, limit, offset int) ([]Club, int, error)
	GetByID(ctx context.Context, id string) (*Club, error)
	Create(ctx context.Context, club *Club) error
	Update(ctx context.Context, club *Club) error
	Delete(ctx context.Context, id string) error
}
