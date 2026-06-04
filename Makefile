# CivilierERP Docker helpers
# Usage: make <target>

.PHONY: up down build logs ps shell-backend shell-redis clean

## Start all services (build if needed)
up:
	docker compose up --build -d
	@echo ""
	@echo "  CivilierERP is starting up."
	@echo "  Frontend  → http://localhost"
	@echo "  Backend   → http://localhost/api"
	@echo ""
	@echo "  Check status: make logs"

## Stop all services
down:
	docker compose down

## Rebuild images without cache
build:
	docker compose build --no-cache

## Tail logs for all services
logs:
	docker compose logs -f

## Show running containers
ps:
	docker compose ps

## Shell into the backend container
shell-backend:
	docker compose exec backend sh

## Redis CLI (uses the temp password)
shell-redis:
	docker compose exec redis redis-cli -a CIVILIER_REDIS_TEMP_2025

## Remove containers, volumes, and images
clean:
	docker compose down -v --rmi local
