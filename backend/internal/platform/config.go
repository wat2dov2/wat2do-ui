package platform

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Port               string
	Env                string
	LogLevel           string
	CORSAllowedOrigins []string
	DatabaseURL        string
}

func (c Config) IsDevelopment() bool {
	return c.Env == "development"
}

func (c Config) IsProduction() bool {
	return c.Env == "production"
}

func LoadConfig() (*Config, error) {
	cfg := &Config{
		Port:               envOrDefault("PORT", "8080"),
		Env:                envOrDefault("ENV", "development"),
		LogLevel:           envOrDefault("LOG_LEVEL", "debug"),
		CORSAllowedOrigins: strings.Split(envOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"), ","),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("config validation: %w", err)
	}

	return cfg, nil
}

func (c Config) validate() error {
	if c.Port == "" {
		return fmt.Errorf("PORT is required")
	}
	if c.Env != "development" && c.Env != "staging" && c.Env != "production" {
		return fmt.Errorf("ENV must be one of: development, staging, production")
	}
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	return nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
