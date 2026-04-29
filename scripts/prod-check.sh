#!/usr/bin/env bash
set -euo pipefail

source .env.production

curl -fsS "https://${API_DOMAIN}/api/v1/health"
curl -fsS "https://${API_DOMAIN}/api/v1/ready"
curl -fsS "https://${API_DOMAIN}/metrics"
