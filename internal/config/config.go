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
	ReposDir       string
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
		dbPath = filepath.Join(baseDir, "jobs.sqlite")
	}

	return &Config{
		PyrunnerDir:    baseDir,
		BinDir:         filepath.Join(baseDir, "bin"),
		LogsDir:        filepath.Join(baseDir, "logs"),
		ReposDir:       filepath.Join(baseDir, "repos"),
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
		ReposDir:       filepath.Join(baseDir, "repos"),
		DaemonIpcPath:  filepath.Join(baseDir, "daemon.sock"),
		DBPath:         filepath.Join(baseDir, "jobs.sqlite"),
		DefaultTimeout: DefaultJobTimeout,
	}
}

// EnsureEnv creates the per-user runtime directories if they don't exist.
// The PyRunner root is created with 0700 because the daemon's HTTP control
// API is unauthenticated — anyone with read access to the socket can list,
// edit, run, and kill jobs. BinDir is 0755 for easy inspection; LogsDir and
// ReposDir are 0700 because script output can contain secrets and cloned
// repos may hold private code — other users on the machine have no business
// reading them. Editors and uv run as the same user, so they are unaffected
// by the absence of group/other bits.
func (c *Config) EnsureEnv() error {
	if err := os.MkdirAll(c.PyrunnerDir, 0o700); err != nil {
		return err
	}
	// Directory modes are only applied at creation; a directory left loose by
	// an older version (or a widened one) is tightened back to 0700 here.
	for _, dir := range []string{c.LogsDir, c.ReposDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
		if info, err := os.Stat(dir); err == nil && info.Mode().Perm()&0o077 != 0 {
			_ = os.Chmod(dir, 0o700)
		}
	}
	if err := os.MkdirAll(c.BinDir, 0o755); err != nil {
		return err
	}
	return nil
}
