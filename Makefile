.PHONY: install build setup dev chat test clean docker-up docker-down http-gateway

install:
	pnpm install

build:
	pnpm nx run-many --target=build --all

setup: build
	node packages/cli/dist/index.js setup

dev:
	pnpm nx run @jarvis/cli:dev

chat:
	node packages/cli/dist/index.js chat

test:
	pnpm nx run-many --target=test --all

http-gateway:
	node packages/http-gateway/dist/index.js

clean:
	rm -rf packages/*/dist packages/skills/*/dist data/jarvis.db

docker-up:
	docker compose -f docker/docker-compose.yml up -d

docker-down:
	docker compose -f docker/docker-compose.yml down
