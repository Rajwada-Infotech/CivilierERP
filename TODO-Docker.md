# Docker Production Setup - CivilierERP ✅

## Progress Checklist
- [x] 1. Created docker-compose.yml (multi-replica backend + Redis + NGINX)
- [x] 2. Created nginx.conf (load balancer for /api/)
- [x] 3. Created backend/Dockerfile + .dockerignore
- [x] 4. Created .env.example (copy to .env, fill DB creds)

## Run Commands
1. `cp .env.example .env` & edit DB_USER/PASSWORD/SERVER
2. `docker compose up -d --build`
3. Scale: `docker compose up -d --scale backend=3 --no-deps`
4. Access: http://localhost (NGINX), http://localhost/api/ (direct backend)
5. Logs: `docker compose logs -f backend`
6. Health: `curl http://localhost/health`

## Verify
- Backend healthy, Redis connected (check logs)
- Frontend: Update axios base to http://localhost/api if needed (CORS ok)

## Next
- [ ] Migrate data? Run `docker compose exec backend node run-migration.cjs`
- [ ] Production: Add Redis password, SQL network access, volumes.

Updated $(date)
- [ 
