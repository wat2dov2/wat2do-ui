package platform

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

var (
	ErrNotFound      = errors.New("resource not found")
	ErrAlreadyExists = errors.New("resource already exists")
	ErrUnauthorized  = errors.New("unauthorized")
	ErrForbidden     = errors.New("forbidden")
	ErrValidation    = errors.New("validation error")
)

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationErrors struct {
	Errors []ValidationError `json:"errors"`
}

func (v *ValidationErrors) Add(field, message string) {
	v.Errors = append(v.Errors, ValidationError{Field: field, Message: message})
}

func (v *ValidationErrors) HasErrors() bool {
	return len(v.Errors) > 0
}

func (v *ValidationErrors) Error() string {
	if len(v.Errors) == 0 {
		return "validation failed"
	}
	return "validation failed: " + v.Errors[0].Field + " " + v.Errors[0].Message
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Details any    `json:"details,omitempty"`
}

func HandleError(c *gin.Context, logger *slog.Logger, err error) {
	var validationErrs *ValidationErrors
	if errors.As(err, &validationErrs) {
		c.JSON(http.StatusUnprocessableEntity, ErrorResponse{
			Error:   "validation failed",
			Details: validationErrs.Errors,
		})
		return
	}

	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, ErrorResponse{Error: "not found"})
	case errors.Is(err, ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, ErrorResponse{Error: "unauthorized"})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, ErrorResponse{Error: "forbidden"})
	case errors.Is(err, ErrValidation):
		c.JSON(http.StatusBadRequest, ErrorResponse{Error: "bad request"})
	case errors.Is(err, ErrAlreadyExists):
		c.JSON(http.StatusConflict, ErrorResponse{Error: "already exists"})
	default:
		logger.Error("unhandled error", "error", err)
		c.JSON(http.StatusInternalServerError, ErrorResponse{Error: "internal server error"})
	}
}
