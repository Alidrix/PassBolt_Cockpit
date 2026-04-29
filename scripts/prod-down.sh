#!/usr/bin/env bash
set -euo pipefail

docker compose --env-file .env.production -f docker-compose.prod.yml down
