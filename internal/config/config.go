package config

import (
	"os"
	"path/filepath"
)

const DefaultJobTimeout = 600 // seconds (10 minutes)

type Config struct {
	PyrunnerDir    string
	BinDir         string
	LogsDir        string
	DaemonIpcPath  string
	DBPath         string
	DefaultTimeout int // seconds
}

func New() *Config {
	return newFromEnv(os.Getenv)
}

func newFromEnv(getenv func(string) string) *Config {
	baseDir := getenv("PYRUNNER_DIR")
	if baseDir == "" {
		home, _ := os.UserHomeDir()
		baseDir = filepath.Join(home, ".pyrunner")
	}

	dbPath := getenv("PYRUNNER_DB_PATH")
	if dbPath == "" {
		if getenv("NODE_ENV") == "test" {
			dbPath = ":memory:"
		} else {
			dbPath = filepath.Join(baseDir, "jobs.sqlite")
		}
	}

	return &Config{
		PyrunnerDir:    baseDir,
		BinDir:         filepath.Join(baseDir, "bin"),
		LogsDir:        filepath.Join(baseDir, "logs"),
		DaemonIpcPath:  filepath.Join(baseDir, "daemon.sock"),
		DBPath:         dbPath,
		DefaultTimeout: DefaultJobTimeout,
	}
}

func (c *Config) GetDaemonIpcPath() string { return c.DaemonIpcPath }
func (c *Config) GetLogsDir() string       { return c.LogsDir }
func (c *Config) GetDefaultTimeout() int   { return c.DefaultTimeout }

// ForTest creates a Config rooted at baseDir (typically a temp directory).
func ForTest(baseDir string) *Config {
	return &Config{
		PyrunnerDir:    baseDir,
		BinDir:         filepath.Join(baseDir, "bin"),
		LogsDir:        filepath.Join(baseDir, "logs"),
		DaemonIpcPath:  filepath.Join(baseDir, "daemon.sock"),
		DBPath:         filepath.Join(baseDir, "jobs.sqlite"),
		DefaultTimeout: DefaultJobTimeout,
	}
}

func (c *Config) EnsureEnv() error {
	for _, dir := range []string{c.PyrunnerDir, c.BinDir, c.LogsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return nil
}
