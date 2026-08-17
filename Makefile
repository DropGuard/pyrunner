BINDIR := ./bin
EXT := $(shell go env GOEXE)

# Version is injected at build time. When releasing, CI passes the git tag
# via VERSION (e.g. `make build VERSION=v0.2.3`). Defaults to the dev value
# baked into internal/version.
VERSION ?= dev
LDFLAGS := -X github.com/DropGuard/pyrunner/internal/version.Version=$(VERSION)

.PHONY: build build-cli build-daemon install test vet clean

build: build-cli build-daemon

build-cli:
	go build -ldflags "$(LDFLAGS)" -o $(BINDIR)/pyrunner$(EXT) ./cmd/pyrunner/

build-daemon:
	go build -ldflags "$(LDFLAGS)" -o $(BINDIR)/pyrunnerd$(EXT) ./cmd/pyrunnerd/

install: build
	$(BINDIR)/pyrunner$(EXT) install

test:
	go test ./internal/... -v -count=1

vet:
	go vet ./...

clean:
	rm -rf $(BINDIR)
