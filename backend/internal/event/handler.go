package event

import (
	"log/slog"
	"net/http"
	"strconv"

	"campus-events/backend/internal/platform"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
	logger  *slog.Logger
}

func NewHandler(svc *Service, logger *slog.Logger) *Handler {
	return &Handler{service: svc, logger: logger}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	events := rg.Group("/events")
	events.GET("", h.List)
	events.POST("", h.Create)
	events.GET("/:id", h.Get)
	events.PUT("/:id", h.Update)
	events.DELETE("/:id", h.Delete)
}

func (h *Handler) List(c *gin.Context) {
	filter := Filter{
		Category: c.Query("category"),
		Search:   c.Query("search"),
		ClubID:   c.Query("clubId"),
		Status:   c.Query("status"),
		Limit:    queryInt(c, "limit", 20),
		Offset:   queryInt(c, "offset", 0),
	}

	events, total, err := h.service.List(c.Request.Context(), filter)
	if err != nil {
		platform.HandleError(c, h.logger, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  events,
		"total": total,
	})
}

func (h *Handler) Get(c *gin.Context) {
	evt, err := h.service.GetByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		platform.HandleError(c, h.logger, err)
		return
	}
	c.JSON(http.StatusOK, evt)
}

func (h *Handler) Create(c *gin.Context) {
	var evt Event
	if err := c.ShouldBindJSON(&evt); err != nil {
		c.JSON(http.StatusBadRequest, platform.ErrorResponse{Error: "invalid request body"})
		return
	}

	if err := h.service.Create(c.Request.Context(), &evt); err != nil {
		platform.HandleError(c, h.logger, err)
		return
	}

	c.JSON(http.StatusCreated, evt)
}

func (h *Handler) Update(c *gin.Context) {
	var evt Event
	if err := c.ShouldBindJSON(&evt); err != nil {
		c.JSON(http.StatusBadRequest, platform.ErrorResponse{Error: "invalid request body"})
		return
	}
	evt.ID = c.Param("id")

	if err := h.service.Update(c.Request.Context(), &evt); err != nil {
		platform.HandleError(c, h.logger, err)
		return
	}

	c.JSON(http.StatusOK, evt)
}

func (h *Handler) Delete(c *gin.Context) {
	if err := h.service.Delete(c.Request.Context(), c.Param("id")); err != nil {
		platform.HandleError(c, h.logger, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func queryInt(c *gin.Context, key string, fallback int) int {
	v := c.Query(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
