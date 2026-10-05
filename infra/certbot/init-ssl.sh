#!/bin/bash
set -e

# ==============================================================================
# CN-BD Connect: Automated Let's Encrypt SSL Bootstrap
# ==============================================================================

DOMAINS=(
  "cn-bd-connect-app.shahmdmahi.dpdns.org"
  "cn-bd-connect-api.shahmdmahi.dpdns.org"
  "cn-bd-connect-turn.shahmdmahi.dpdns.org"
)

EMAIL=${CERTBOT_EMAIL:-"admin@shahmdmahi.dpdns.org"}
STAGING=${CERTBOT_STAGING:-"0"} # Set to 1 for testing to avoid rate limits
DATA_PATH="./infra/certbot/conf"

echo "==> Preparing certificate directories..."
mkdir -p "$DATA_PATH/live"

# Check if certificates exist or need dummy bootstrap so Nginx can start
DUMMY_DOMAINS=()
for domain in "${DOMAINS[@]}"; do
  CERT_DIR="$DATA_PATH/live/$domain"
  if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    echo "==> Generating fallback self-signed certificate for $domain (so Nginx can start)..."
    mkdir -p "$CERT_DIR"
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "$CERT_DIR/privkey.pem" \
      -out "$CERT_DIR/fullchain.pem" \
      -subj "/CN=localhost"
    DUMMY_DOMAINS+=("$domain")
  fi
done

echo "==> Ensuring Nginx is running to serve ACME challenge..."
docker compose up -d nginx

echo "==> Checking official Let's Encrypt SSL certificates..."
STAGING_ARG=""
if [ "$STAGING" != "0" ]; then
  STAGING_ARG="--staging"
fi

for domain in "${DOMAINS[@]}"; do
  CERT_DIR="$DATA_PATH/live/$domain"
  ISSUER=$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -issuer 2>/dev/null || echo "")
  
  if echo "$ISSUER" | grep -q "Let's Encrypt"; then
    echo "==> Valid Let's Encrypt certificate already active for $domain. Skipping."
    continue
  fi

  # If dummy certificate was created, remove it before calling certbot so certbot won't complain about live dir
  if [ -d "$CERT_DIR" ] && [ ! -L "$CERT_DIR/fullchain.pem" ]; then
    echo "==> Removing temporary self-signed certificate for $domain..."
    rm -rf "$CERT_DIR"
  fi

  echo "==> Obtaining official Let's Encrypt certificate for $domain..."
  docker compose run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email $EMAIL \
    -d $domain \
    --keep-until-expiring \
    --agree-tos \
    --non-interactive" certbot
done

echo "==> Setting certificate permissions..."
sudo chmod -R 755 "$DATA_PATH/live" "$DATA_PATH/archive" 2>/dev/null || true

echo "==> Reloading Nginx with production certificates..."
docker compose exec nginx nginx -s reload

echo "==> Restarting Coturn media relay to load certificates..."
docker compose restart coturn || true

echo "==> SSL Certificate Provisioning Complete!"
