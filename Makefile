PYTHON_VERSION := 3.12
PORT ?= 8000

.PHONY: install build run

install:
	uv python install $(PYTHON_VERSION)
	uv venv --python $(PYTHON_VERSION) .venv
	uv sync
	npm install

build:
	npm run build

run: build
	.venv/bin/python -m http.server $(PORT) --bind 127.0.0.1 --directory dist
