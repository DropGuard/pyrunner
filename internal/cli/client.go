package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	apperrors "github.com/DropGuard/pyrunner/internal/errors"
)

type Client struct {
	httpClient *http.Client
	baseURL    string
	ipcPath    string
}

const (
	// dialTimeout bounds the Unix socket connect. A stale socket file whose
	// daemon died makes connect fail immediately; a live-but-saturated socket
	// would otherwise hang the CLI forever.
	dialTimeout = 3 * time.Second
	// clientTimeout bounds the whole control-plane request. Normal operations
	// (list/add/edit/run/kill/logs) are sub-second on a healthy daemon; the
	// ceiling exists so a wedged daemon (SQLite lock, hung handler) surfaces
	// as a clear error instead of a frozen terminal.
	clientTimeout = 15 * time.Second
)

func NewClient(ipcPath string) *Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: dialTimeout}
			return d.DialContext(ctx, "unix", ipcPath)
		},
	}
	return &Client{
		httpClient: &http.Client{Transport: transport, Timeout: clientTimeout},
		baseURL:    "http://localhost", // dummy host, real connection goes through unix socket
		ipcPath:    ipcPath,
	}
}

func (c *Client) do(method, path string, body interface{}) (*apperrors.APIResponse, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, &apperrors.DaemonOfflineError{}
	}
	defer resp.Body.Close()

	var apiResp apperrors.APIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if !apiResp.OK {
		return nil, &apperrors.APIError{Code: apiResp.Code, Message: apiResp.Error}
	}
	return &apiResp, nil
}

func (c *Client) Health() (map[string]interface{}, error) {
	resp, err := c.do("GET", "/api/v1/health", nil)
	if err != nil {
		return nil, err
	}
	data, _ := resp.Data.(map[string]interface{})
	return data, nil
}

func (c *Client) DaemonStatus() (map[string]interface{}, error) {
	resp, err := c.do("GET", "/api/v1/daemon/status", nil)
	if err != nil {
		return nil, err
	}
	data, _ := resp.Data.(map[string]interface{})
	return data, nil
}

func (c *Client) ListJobs() ([]map[string]interface{}, error) {
	resp, err := c.do("GET", "/api/v1/jobs", nil)
	if err != nil {
		return nil, err
	}
	jobs, _ := resp.Data.([]interface{})
	result := make([]map[string]interface{}, len(jobs))
	for i, j := range jobs {
		result[i], _ = j.(map[string]interface{})
	}
	return result, nil
}

func (c *Client) AddJob(name, scriptPath, cron string) (map[string]interface{}, error) {
	resp, err := c.do("POST", "/api/v1/jobs", map[string]string{
		"name":        name,
		"script_path": scriptPath,
		"cron":        cron,
	})
	if err != nil {
		return nil, err
	}
	data, _ := resp.Data.(map[string]interface{})
	return data, nil
}

func (c *Client) EditJob(name string, updates map[string]interface{}) (map[string]interface{}, error) {
	resp, err := c.do("PATCH", "/api/v1/jobs/"+name, updates)
	if err != nil {
		return nil, err
	}
	data, _ := resp.Data.(map[string]interface{})
	return data, nil
}

func (c *Client) RemoveJob(name string) error {
	_, err := c.do("DELETE", "/api/v1/jobs/"+name, nil)
	return err
}

func (c *Client) RunJob(name string) error {
	_, err := c.do("POST", "/api/v1/jobs/"+name+"/run", nil)
	return err
}

func (c *Client) KillJob(name string) error {
	_, err := c.do("POST", "/api/v1/jobs/"+name+"/kill", nil)
	return err
}

func (c *Client) KillAllJobs() (int, error) {
	resp, err := c.do("POST", "/api/v1/jobs/kill-all", nil)
	if err != nil {
		return 0, err
	}
	data, _ := resp.Data.(map[string]interface{})
	killed, _ := data["killed"].(float64)
	return int(killed), nil
}

func (c *Client) GetJobLogs(name string, lines int) (string, error) {
	path := "/api/v1/jobs/" + name + "/logs"
	if lines > 0 {
		path += fmt.Sprintf("?lines=%d", lines)
	}
	resp, err := c.do("GET", path, nil)
	if err != nil {
		return "", err
	}
	data, _ := resp.Data.(map[string]interface{})
	content, _ := data["content"].(string)
	return content, nil
}

func (c *Client) GetAllLogs() (map[string]string, error) {
	resp, err := c.do("GET", "/api/v1/logs", nil)
	if err != nil {
		return nil, err
	}
	data, _ := resp.Data.(map[string]interface{})
	logs := make(map[string]string, len(data))
	for k, v := range data {
		logs[k], _ = v.(string)
	}
	return logs, nil
}

func (c *Client) Shutdown() error {
	_, err := c.do("POST", "/api/v1/daemon/shutdown", nil)
	return err
}
