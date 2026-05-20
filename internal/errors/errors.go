package errors

import "fmt"

type ErrorCode string

const (
	ErrJobNotFound    ErrorCode = "JOB_NOT_FOUND"
	ErrDaemonOffline  ErrorCode = "DAEMON_OFFLINE"
	ErrValidation     ErrorCode = "VALIDATION_ERROR"
	ErrAlreadyRunning ErrorCode = "ALREADY_RUNNING"
	ErrScriptNotFound ErrorCode = "SCRIPT_NOT_FOUND"
	ErrNameConflict   ErrorCode = "NAME_CONFLICT"
)

type APIResponse struct {
	OK    bool        `json:"ok"`
	Data  interface{} `json:"data,omitempty"`
	Error string      `json:"error,omitempty"`
	Code  ErrorCode   `json:"code,omitempty"`
}

func OK(data interface{}) APIResponse {
	return APIResponse{OK: true, Data: data}
}

func Err(code ErrorCode, msg string) APIResponse {
	return APIResponse{OK: false, Error: msg, Code: code}
}

type DaemonOfflineError struct{}

func (e *DaemonOfflineError) Error() string {
	return "Scheduler daemon is not running"
}

type APIError struct {
	Code    ErrorCode
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}
