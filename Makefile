GO ?= go
WAILS ?= wails

.PHONY: test desktop-build desktop-dev desktop-bindings
test:
	$(GO) test ./internal/desktop/...
	$(GO) vet ./internal/desktop/...
	npm --prefix frontend run test:ci
desktop-build:
	$(WAILS) build -tags webkit2_41 -trimpath
desktop-dev:
	$(WAILS) dev -tags webkit2_41
desktop-bindings:
	$(WAILS) generate module
