#!/bin/bash
set -e

# ==============================================================================
# CN-BD Connect: Automated Let's Encrypt SSL Bootstrap
# ==============================================================================

DOMAINS=(
  "cn-bd-connect-app.shahmdmahi.dpdns.org"
  "cn-bd-connect-api.shahmdmahi.dpdns.org"
  "cn-bd-connect-turn.dpdns.org"
)

EMAIL=${CERTBOT_EMAIL:-"admin@shahmdmahi.dpdns.org"}
STAGING=${CERTBOT_STAGING:-"0"} # Set to 1 for testing to avoid rate limits
DATA_PATH="./infra/certbot/conf"

echo "==> Preparing certificate directories..."
mkdir -p "$DATA_PATH/live"

for domain in "${DOMAINS[@]}"; do
  CERT_DIR="$DATA_PATH/live/$domain"
  if [ ! -d "$CERT_DIR" ]; then
    echo "==> Generating fallback self-signed certificate for $domain (so Nginx can start)..."
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "$CERT_DIR/privkey.pem" \
      -out "$CERT_DIR/fullchain.pem" \
      -subj "/CN=localhost"
  fi
done

echo "==> Starting Nginx to serve ACME challenge..."
docker compose up -d nginx

echo "==> Requesting official Let's Encrypt SSL certificates..."
STAGING_ARG=""
if [ "$STAGING" != "0" ]; then
  STAGING_ARG="--staging"
fi

for domain in "${DOMAINS[@]}"; do
  echo "==> Obtaining certificate for $domain..."
  docker compose run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    -d $domain \
    --rsa-key-size 4096 \
    --agree-tos \
    --force-renewal \
    --non-interactive" certbot
done

echo "==> Reloading Nginx with new production certificates..."
docker compose exec nginx nginx -s reload

echo "==> Setting certificate permissions for Coturn relay daemon..."
sudo chmod -R 755 "$DATA_PATH/live" "$DATA_PATH/archive" 2>/dev/null || true

echo "==> SSL Certificate Provisioning Complete!"
