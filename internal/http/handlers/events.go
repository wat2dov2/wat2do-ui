package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"wat2do-ui/backend/internal/domain"
	"wat2do-ui/backend/internal/store"
)

type EventsHandler struct {
	store         *store.PostgresStore
	scraperAPIKey string
}

func NewEventsHandler(store *store.PostgresStore, scraperAPIKey string) *EventsHandler {
	return &EventsHandler{store: store, scraperAPIKey: scraperAPIKey}
}

func (h *EventsHandler) GetEvents(w http.ResponseWriter, r *http.Request) {
	limit := parseIntOrDefault(r.URL.Query().Get("limit"), 50)
	offset := parseIntOrDefault(r.URL.Query().Get("offset"), 0)

	events, err := h.store.ListEvents(r.Context(), limit, offset)
	if err != nil {
		http.Error(w, "failed to list events", http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (h *EventsHandler) PostEvent(w http.ResponseWriter, r *http.Request) {
	if h.scraperAPIKey != "" && r.Header.Get("X-Scraper-API-Key") != h.scraperAPIKey {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req domain.CreateEventRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Title == "" || req.Location == "" || req.ScrapingMetadata.ScraperSource == "" {
		http.Error(w, "title, location, and scraping metadata are required", http.StatusBadRequest)
		return
	}

	created, err := h.store.CreateEvent(r.Context(), req)
	if err != nil {
		http.Error(w, "failed to create event", http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusCreated, created)
}

func parseIntOrDefault(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
