package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"campus-events/backend/internal/event"
	"campus-events/backend/internal/middleware"
	"campus-events/backend/internal/platform"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	if err := godotenv.Load(); err == nil {
		logger.Debug("loaded .env")
	}

	cfg, err := platform.LoadConfig()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger.Info("config loaded", "env", cfg.Env, "port", cfg.Port)

	router := setupRouter(cfg, logger)

	ctx := context.Background()
	eventRepo, err := event.NewPostgresRepository(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer eventRepo.Close()

	eventSvc := event.NewService(eventRepo)
	eventHandler := event.NewHandler(eventSvc, logger)

	v1 := router.Group("/api/v1")
	eventHandler.RegisterRoutes(v1)

	srv := platform.NewServer(cfg, logger, router)

	go func() {
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	logger.Info("shutdown signal received", "signal", sig.String())

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("forced shutdown", "error", err)
		os.Exit(1)
	}

	logger.Info("server stopped gracefully")
}

func setupRouter(cfg *platform.Config, logger *slog.Logger) *gin.Engine {
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(
		gin.Recovery(),
		middleware.StructuredLogger(logger),
		cors.New(cors.Config{
			AllowOrigins:     cfg.CORSAllowedOrigins,
			AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
			AllowCredentials: true,
			MaxAge:           24 * time.Hour,
		}),
	)

	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	return router
}
