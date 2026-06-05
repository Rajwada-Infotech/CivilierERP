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

Deploy:

```bash
cd /opt/civilier
CIVILIER_ENV_FILE=/etc/civilier/prod.env bash scripts/deploy.sh main
```

## GitHub Actions

Add these repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `EC2_INSTANCE_ID`

Pushes to `dev` and pull requests run checks only. Pushes to `main` run checks and deploy through AWS SSM.

## Smoke Test

```bash
docker compose ps
curl http://localhost/health/live
set -a && source /etc/civilier/prod.env && set +a
curl -H "X-Health-Token: $HEALTH_TOKEN" http://localhost/health/ready
```

Then test login, socket updates, ticket chat, approvals, purchase order creation, and reporting through the browser.
