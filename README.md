# CN-BD Connect 🇧🇩 🇨🇳

Ultra low-latency video and audio calling application specifically architected to bridge **China and Bangladesh** via a dedicated **AWS Lightsail instance (1 vCPU, 2 GB RAM, 60 GB SSD) in Hong Kong (`ap-east-1`)**.

Featuring **Next.js 16+ App Router (`proxy.ts`)**, a **standalone mobile-first PWA**, **NestJS WebSockets**, **PostgreSQL (Prisma ORM)**, **Redis presence**, **Coturn (STUN/TURN/TURNS on Port 443 GFW bypass)**, and **automated GitHub Actions CI/CD**.

---

## 🌐 1. Domain & Cloudflare DNS Setup

On your Cloudflare Dashboard for `shahmdmahi.dpdns.org`:

| Type | Name / Subdomain | Target | Cloudflare Proxy | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `cn-bd-connect-app` | `<LIGHTSAIL_STATIC_IP>` | **Proxied (Orange Cloud)** | Next.js 16 PWA Client Shell |
| **A** | `cn-bd-connect-api` | `<LIGHTSAIL_STATIC_IP>` | **Proxied (Orange Cloud)** | NestJS REST API & WebSocket Signaling (`wss://`) |
| **A** | `cn-bd-connect-turn` | `<LIGHTSAIL_STATIC_IP>` | **DNS Only (GREY CLOUD)** | **CRITICAL: Coturn STUN/TURN/TURNS Media Relay** |

> [!CAUTION]
> **`cn-bd-connect-turn` MUST BE GREY CLOUD (DNS Only)**. Cloudflare free/pro tiers do not proxy WebRTC UDP media packets. Enabling Orange Cloud on the TURN domain will break all media streaming!

---

## 🚀 2. AWS Lightsail Setup (Hong Kong ap-east-1)

1. **Create Instance:**
   - Platform: **Linux/Unix**
   - OS: **Ubuntu 26.04 LTS** (or 24.04/22.04 LTS)
   - Plan: **$7 / month (1 vCPU, 2 GB RAM, 60 GB SSD, 3 TB Bandwidth)**
   - Region: **Hong Kong (`ap-east-1`)**
2. **Assign Static IP:**
   - Go to *Networking* > *Create static IP* > Attach it to your instance.
3. **Firewall / Networking Rules (AWS Lightsail Console):**
   Open the following inbound ports:
   - `TCP 22` (SSH)
   - `TCP 80` (HTTP / Let's Encrypt ACME)
   - `TCP 443` (HTTPS & Coturn TURNS SNI Multiplexing)
   - `TCP 3478` & `UDP 3478` (STUN / TURN)
   - `TCP 5349` & `UDP 5349` (TURNS over TLS)
   - `UDP 49152-49352` (Coturn WebRTC Media Relay UDP Ports)

---

## 🔑 3. GitHub Secrets Configuration (Automated CI/CD)

In your GitHub repository (**Settings > Secrets and variables > Actions > New repository secret**), add:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `LIGHTSAIL_HOST` | `18.xxx.xxx.xxx` | Your AWS Lightsail Hong Kong dedicated Static IP |
| `LIGHTSAIL_USERNAME` | `ubuntu` | Default Ubuntu username |
| `LIGHTSAIL_SSH_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | Contents of your Lightsail `.pem` private key |

Whenever you push to the `master` or `main` branch, the GitHub Actions pipeline will:
1. Run linting, TypeScript validation, and build verification.
2. Connect to the Lightsail server via SSH.
3. Pull the latest code, build Docker containers, run Prisma database migrations, and perform a rolling restart.

---

## ⚡ 4. Initial Server Setup (Run Once on Lightsail)

SSH into your Lightsail server:
```bash
ssh -i your-lightsail-key.pem ubuntu@<LIGHTSAIL_STATIC_IP>
```

Clone the repository and run the automated optimization script:
```bash
git clone https://github.com/shahmdmahi15/cn-bd-connect.git
cd cn-bd-connect
cp .env.example .env

# Edit .env if you wish to adjust secrets
nano .env

# Run Ubuntu 26.04 BBR kernel tuning, firewall, and Let's Encrypt SSL bootstrap
./infra/scripts/setup-lightsail.sh
```

---

## 📱 5. Features & Calling Experience

- **Email-Based Friend Requests:** Connect by entering any user's email address. Real-time notifications for incoming requests with one-tap Accept/Reject.
- **Real-Time Presence:** Friends list automatically updates with green/gray online badges using persistent WebSockets.
- **Great Firewall (GFW) Bypass:**
  - Multi-transport fallback: `Direct P2P` ➔ `Coturn UDP` ➔ `Coturn TCP (3478)` ➔ `TURNS over TLS (5349)` ➔ `TURNS on Port 443 (HTTPS disguise)`.
- **Live Connection Quality HUD:** View live Round Trip Time (RTT), bitrate (Mbps), and packet loss percentage during calls.
- **Installable PWA:** Install directly to your Android, iOS, or Desktop home screen. Operates with wake lock and native Web Audio ringtones.

---

## 🛠 Local Development

```bash
# Install dependencies across pnpm monorepo
pnpm install

# Generate Prisma Client
pnpm --filter api exec prisma generate

# Run services locally
pnpm dev:api   # NestJS API & Signaling (Port 3001)
pnpm dev:web   # Next.js 16 PWA Client (Port 3000)
```
