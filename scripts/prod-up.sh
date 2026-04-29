#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env.production ]; then
  echo "Missing .env.production. Copy .env.production.example first."
  exit 1
fi

mkdir -p infra/traefik/acme
touch infra/traefik/acme/acme.json
chmod 600 infra/traefik/acme/acme.json

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
