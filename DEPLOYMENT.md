# CivilierERP AWS Deployment

This repo is prepared for a single EC2 Docker host behind an AWS Application Load Balancer, with SQL Server on RDS and Redis in Docker.

## Before AWS

Generate production secrets and store them somewhere safe:

```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 32   # REDIS_PASSWORD
openssl rand -hex 32   # HEALTH_TOKEN
```

Do not commit `backend/.env` or `/etc/civilier/prod.env`.

## Recommended AWS Shape

- Region: `ap-south-1`
- ALB: public, HTTPS 443 with ACM certificate
- EC2: private subnet, Docker host, receives traffic from ALB on port 80
- RDS SQL Server: private subnet, accepts 1433 only from EC2 security group
- Security groups:
  - ALB: `443` from internet
  - EC2: `80` from ALB only, SSM enabled for shell access
  - RDS: `1433` from EC2 only

## First EC2 Setup

Clone or copy this repo to the instance, then run:

```bash
REPO_URL=https://github.com/YOUR_ORG/CivilierERP.git bash scripts/setup-ec2.sh
```

Create `/etc/civilier/prod.env` using `backend/.env.example` as the template:

```env
NODE_ENV=production
PORT=5000
DB_SERVER=your-rds-endpoint.ap-south-1.rds.amazonaws.com
DB_PORT=1433
DB_NAME=CivilierERP
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
JWT_SECRET=generated_hex_64
JWT_EXPIRES_IN=7d
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=generated_hex_32
REDIS_DB=0
ALLOWED_ORIGINS=https://civiliererp.in,https://www.civiliererp.in
HEALTH_TOKEN=generated_hex_32
```

Protect it:

```bash
sudo chown root:root /etc/civilier/prod.env
sudo chmod 600 /etc/civilier/prod.env
```

Deploy (first time, from this same SSH session, using a copy of the repo
already on disk — for every deploy *after* this one, use the artifact-based
flow below instead):

```bash
cd /opt/civilier
CIVILIER_ENV_FILE=/etc/civilier/prod.env bash scripts/deploy.sh main
```

## Releasing updates (after the first deploy)

Pushing to `main` does **not** deploy anything by itself — it only runs the
CI checks (build + test) in GitHub Actions. Nothing in this repo can reach
the EC2 box automatically. A release is a deliberate, two-step action:

1. **Build it.** In GitHub: Actions tab → "CI" workflow → "Run workflow" →
   pick the branch (usually `main`) → Run. Wait for it to finish, open the
   run, and download the `.zip` under "Artifacts".
2. **Deploy it.** Copy that `.zip` onto the EC2 box (`scp`, WinSCP,
   FileZilla — whatever you already use to reach the instance), then run:

   ```bash
   bash /opt/civilier/scripts/deploy-from-artifact.sh /path/to/civilier-source-main-42.zip
   ```

That script extracts the zip, keeps the previous release at
`/opt/civilier.previous` for a one-command rollback (it prints the exact
command if the health check fails), then runs the same build/migrate/start
sequence as before. See the comments at the top of
`scripts/deploy-from-artifact.sh` for the full walkthrough.

> ### ⚠️ ONE-TIME: baseline the migration tracker before the first migrate
>
> The deploy runs `node migrate.js up`. That is only safe if `dbo.__Migrations`
> already records the migrations whose schema is live. On any database that was
> built/restored **without** umzug (its `__Migrations` table is empty or
> missing while the schema is fully applied), `migrate.js up` will try to
> **re-run every migration** — including non-idempotent drops/renames — and
> will fail or corrupt the schema.
>
> Before the first deploy against such a database (this was the case on the
> dev `Civilier` DB — see the migration-tracker note), run **once**:
>
> ```bash
> cd backend
> node scripts/baseline-migrations.js            # dry-run: preview
> node scripts/baseline-migrations.js --apply    # mark applied (tracking only)
> node migrate.js status                         # expect Pending (0)
> ```
>
> This writes only to `dbo.__Migrations` (tracking rows) — never to schema or
> data — and is reversible. After baselining, `migrate.js up` applies only
> genuinely new migrations. Only run it against a DB whose schema you have
> confirmed already reflects the migrations being baselined.

The old `scripts/deploy.sh` (live `git pull` on the box) still exists and
still works if you ever want it, but nothing triggers it automatically
anymore — GitHub Actions no longer has AWS credentials or talks to this box
at all.

## GitHub Actions

No repository secrets are required anymore — the CI workflow only builds
and tests; it never calls AWS. (If `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `EC2_INSTANCE_ID` secrets are still
set on the repo from before, they're unused now and safe to delete.)

Pushes and pull requests to `main`/`dev` run checks only — build, test,
syntax check, Docker build check. Nothing deploys. Deploying is the manual
two-step process described above.

## Smoke Test

```bash
docker compose ps
curl http://localhost/health/live
set -a && source /etc/civilier/prod.env && set +a
curl -H "X-Health-Token: $HEALTH_TOKEN" http://localhost/health/ready
```

Then test login, socket updates, ticket chat, approvals, purchase order creation, and reporting through the browser.