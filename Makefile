BINDIR := ./bin
EXT := $(shell go env GOEXE)

.PHONY: build build-cli build-daemon install test clean

build: build-cli build-daemon

build-cli:
	go build -o $(BINDIR)/pyrunner$(EXT) ./cmd/pyrunner/

build-daemon:
	go build -o $(BINDIR)/pyrunnerd$(EXT) ./cmd/pyrunnerd/

install: build
	$(BINDIR)/pyrunner$(EXT) install

test:
	go test ./internal/... -v -count=1

vet:
	go vet ./...

clean:
	rm -rf $(BINDIR)
