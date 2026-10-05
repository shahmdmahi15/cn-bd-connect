#!/bin/bash
set -e

# ==============================================================================
# AWS Lightsail Ubuntu 26.04 Hong Kong Optimization & Setup Script
# Run this once on your newly launched Lightsail instance.
# ==============================================================================

echo "=================================================================="
echo "    Setting up CN-BD Connect on AWS Lightsail (Hong Kong)        "
echo "=================================================================="

# 1. Update OS packages
echo "==> 1. Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw openssl git

# 2. Kernel Tuning: Google BBR Congestion Control & UDP Buffers
echo "==> 2. Enabling Linux BBR Congestion Control & Enlarging Network Buffers..."
sudo bash -c 'cat <<EOF > /etc/sysctl.d/99-cn-bd-tuning.conf
# Google BBR for High Packet-Loss Cross-Border Resilience
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Socket buffer sizes (Up to 16MB for high RTT * Bandwidth product)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# UDP memory buffers for WebRTC audio/video streams
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192
EOF'
sudo sysctl --system

# 3. Install Docker Engine and Docker Compose
echo "==> 3. Installing Docker and Docker Compose..."
if ! command -v docker &> /dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker $USER
fi

# 4. Configure UFW Firewall
echo "==> 4. Configuring Firewall Rules for Lightsail..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP / ACME'
sudo ufw allow 443/tcp comment 'HTTPS / TURNS Fallback'
sudo ufw allow 3478/tcp comment 'Coturn TCP'
sudo ufw allow 3478/udp comment 'Coturn UDP'
sudo ufw allow 5349/tcp comment 'Coturn TURNS TLS'
sudo ufw allow 5349/udp comment 'Coturn TURNS UDP'
sudo ufw allow 49152:49352/udp comment 'Coturn WebRTC Media Relay'
sudo ufw --force enable

# 5. Initialize Let's Encrypt SSL
echo "==> 5. Initializing SSL Certificates..."
chmod +x ./infra/certbot/init-ssl.sh
./infra/certbot/init-ssl.sh

echo "=================================================================="
echo "    Setup Complete! You can now run:                             "
echo "    docker compose up -d                                         "
echo "=================================================================="
