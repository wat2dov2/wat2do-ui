package handlers

import (
	"net/http"

	"wat2do-ui/backend/internal/store"
)

type ClubsHandler struct {
	store *store.PostgresStore
}

func NewClubsHandler(store *store.PostgresStore) *ClubsHandler {
	return &ClubsHandler{store: store}
}

func (h *ClubsHandler) GetClubs(w http.ResponseWriter, r *http.Request) {
	clubs, err := h.store.ListClubs(r.Context())
	if err != nil {
		http.Error(w, "failed to list clubs", http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"clubs": clubs})
}
