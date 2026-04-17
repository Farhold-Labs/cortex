# Cortex VPS Deployment Guide

Hardened deployment of Cortex on a fresh VPS with LUKS disk encryption, SQLCipher database encryption, nginx reverse proxy, and automated encrypted backups.

**Target:** Ubuntu 22.04+ VPS with root access

---

## Table of Contents

1. [Initial Server Setup](#1-initial-server-setup)
2. [LUKS Encrypted Partition](#2-luks-encrypted-partition)
3. [Install Dependencies](#3-install-dependencies)
4. [Deploy Cortex](#4-deploy-cortex)
5. [SQLCipher Database Encryption](#5-sqlcipher-database-encryption)
6. [Configure Environment](#6-configure-environment)
7. [Build and Start](#7-build-and-start)
8. [Nginx and SSL](#8-nginx-and-ssl)
9. [Automated Encrypted Backups](#9-automated-encrypted-backups)
10. [Firewall](#10-firewall)
11. [Maintenance](#11-maintenance)

---

## 1. Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Create deploy user
adduser cortex
usermod -aG sudo cortex
```

### SSH Key Setup

Copy your SSH public key to the `cortex` user **before** disabling password auth. Run this from your local machine:

```bash
ssh-copy-id cortex@your-server-ip
```

Verify you can log in with the key (no password prompt):

```bash
ssh cortex@your-server-ip
```

### SSH Hardening

Only after confirming key-based login works:

```bash
# Disable root login and password authentication
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

### Remaining Setup

```bash
# Set timezone
sudo timedatectl set-timezone UTC

# Enable automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 2. LUKS Encrypted Partition

LUKS encrypts the partition at rest. When the server is powered off or the partition is unmounted, data is unreadable without the passphrase.

### Option A: Encrypted Data Directory (Recommended)

Use a dedicated disk or partition for Cortex data. Many VPS providers let you attach a secondary volume.

```bash
# Identify the disk (e.g., /dev/sdb or /dev/vdb)
lsblk

# Install cryptsetup
apt install -y cryptsetup

# Create LUKS partition (you'll be prompted for a passphrase)
cryptsetup luksFormat /dev/sdb

# Open (unlock) the partition
cryptsetup luksOpen /dev/sdb cortex-data

# Create filesystem
mkfs.ext4 /dev/mapper/cortex-data

# Create mount point and mount
mkdir -p /opt/cortex
mount /dev/mapper/cortex-data /opt/cortex

# Set ownership
chown cortex:cortex /opt/cortex
```

### Option B: Encrypted File Container

If you can't add a secondary disk, create a file-backed LUKS container:

```bash
# Create a 10GB container (adjust size as needed)
dd if=/dev/urandom of=/root/cortex-vault.img bs=1M count=10240

# Set up LUKS on the file
cryptsetup luksFormat /root/cortex-vault.img
cryptsetup luksOpen /root/cortex-vault.img cortex-data

# Create filesystem, mount, and set ownership
mkfs.ext4 /dev/mapper/cortex-data
mkdir -p /opt/cortex
mount /dev/mapper/cortex-data /opt/cortex
chown cortex:cortex /opt/cortex
```

### Unlocking on Boot

LUKS partitions require manual unlock after reboot (by design — automatic unlock defeats the purpose). After rebooting:

```bash
# Unlock and mount
cryptsetup luksOpen /dev/sdb cortex-data    # or /root/cortex-vault.img
mount /dev/mapper/cortex-data /opt/cortex

# Then start services
su - cortex -c "cd /opt/cortex && pm2 resurrect"
```

You can script this into an unlock helper:

```bash
cat > /usr/local/bin/cortex-unlock <<'SCRIPT'
#!/bin/bash
set -e
cryptsetup luksOpen /dev/sdb cortex-data
mount /dev/mapper/cortex-data /opt/cortex
su - cortex -c "cd /opt/cortex && pm2 resurrect"
echo "Cortex unlocked and running."
SCRIPT
chmod 700 /usr/local/bin/cortex-unlock
```

---

## 3. Install Dependencies

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Build tools (required for SQLCipher compilation)
apt install -y build-essential python3 git

# SQLCipher system library
apt install -y libsqlcipher-dev

# Nginx
apt install -y nginx

# Certbot for SSL
apt install -y certbot python3-certbot-nginx

# PM2
npm install -g pm2
```

---

## 4. Deploy Cortex

```bash
su - cortex
cd /opt/cortex

# Clone repository
git clone https://github.com/Farhold-Labs/cortex.git app
cd app

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

---

## 5. SQLCipher Database Encryption

SQLCipher encrypts the entire SQLite database file. Even if someone copies the `.db` file off disk, they cannot read it without the key.

### Install SQLCipher Binding

Replace the standard `better-sqlite3` with the SQLCipher-compatible fork:

```bash
cd /opt/cortex/app/server

# Remove standard sqlite binding
npm uninstall better-sqlite3

# Install SQLCipher binding (compiles against system libsqlcipher)
npm install @journeyapps/sqlcipher --build-from-source
```

The `@journeyapps/sqlcipher` package is a drop-in replacement — same API as `better-sqlite3` but compiled against SQLCipher.

### Generate Encryption Key

```bash
openssl rand -hex 32
```

Save this key — you need it every time the server starts. Add it to your `.env` (see next section).

### Important Notes

- **Set the key before first run.** Starting without a key creates an unencrypted database. Encrypting an existing database requires a migration (export → re-import).
- **Losing the key means losing the database.** Back it up separately from the data.
- **REQUIRE_DB_ENCRYPTION=true** in production will cause the server to exit if the key is missing, preventing accidental unencrypted startup.

---

## 6. Configure Environment

```bash
cd /opt/cortex/app/server
cp .env.example .env
chmod 600 .env  # Only owner can read
```

Edit `.env` with your settings:

```bash
# Core
PORT=3001
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 64)
USE_SQLITE=true

# Domain
ALLOWED_ORIGINS=https://cortex.yourdomain.com

# Database encryption (SQLCipher)
DB_ENCRYPTION_KEY=<your-32-byte-hex-key>
REQUIRE_DB_ENCRYPTION=true

# Privacy encryption keys (generate each with: openssl rand -hex 32)
EMAIL_ENCRYPTION_KEY=<32-byte-hex>
WAVE_PARTICIPATION_KEY=<32-byte-hex>
PUSH_SUBSCRIPTION_KEY=<32-byte-hex>
CREW_MEMBERSHIP_KEY=<32-byte-hex>

# Data retention
ACTIVITY_LOG_RETENTION_DAYS=30
SESSION_MAX_AGE_DAYS=30

# GIF provider (optional)
GIF_PROVIDER=tenor
TENOR_API_KEY=<your-key>

# Push notifications (optional)
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_EMAIL=mailto:admin@yourdomain.com

# Federation (optional)
FEDERATION_ENABLED=true
FEDERATION_NODE_NAME=cortex.yourdomain.com

# Email (optional — required for password reset)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email>
SMTP_PASS=<your-app-password>
EMAIL_FROM=noreply@yourdomain.com
```

### Back Up Your Keys

Store a copy of these keys somewhere secure and separate from the server (password manager, encrypted USB, etc.):

- `JWT_SECRET`
- `DB_ENCRYPTION_KEY`
- `EMAIL_ENCRYPTION_KEY`
- `WAVE_PARTICIPATION_KEY`
- `PUSH_SUBSCRIPTION_KEY`
- `CREW_MEMBERSHIP_KEY`
- `VAPID_PRIVATE_KEY`

If you lose the encryption keys, the data they protect is unrecoverable.

---

## 7. Build and Start

```bash
# Build client
cd /opt/cortex/app/client
npm run build

# Start server with PM2
cd /opt/cortex/app/server
pm2 start server.js --name cortex-api

# Serve client with PM2
pm2 serve /opt/cortex/app/client/dist 3000 --name cortex-web --spa

# Verify both are running
pm2 list
pm2 logs cortex-api --lines 20

# Save process list for auto-restart
pm2 save
pm2 startup  # follow the instructions it prints
```

Verify the server starts without errors. Look for:
```
🔐 Database encryption enabled
🔒 Privacy: email encryption enabled
🔒 Privacy: wave participation encryption enabled
🔒 Privacy: push subscription encryption enabled
🔒 Privacy: crew membership encryption enabled
```

---

## 8. Nginx and SSL

### Copy Nginx Config

```bash
sudo cp /opt/cortex/app/landing/nginx.conf /etc/nginx/sites-available/cortex
sudo ln -s /etc/nginx/sites-available/cortex /etc/nginx/sites-enabled/cortex

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default
```

### Edit for Your Domain

Edit `/etc/nginx/sites-available/cortex` and replace:
- `farhold.com` → your root domain
- `cortex.farhold.com` → your app subdomain
- Landing page `root` path → `/opt/cortex/app/landing`

### Get SSL Certificates

```bash
# Temporarily comment out the SSL server blocks and enable HTTP-only for cert issuance,
# or let certbot handle it:
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com -d cortex.yourdomain.com

# Auto-renewal is configured automatically by certbot
sudo certbot renew --dry-run
```

### Test and Reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9. Automated Encrypted Backups

Backups must happen while the LUKS partition is mounted (otherwise there's nothing to back up).

### Create Backup Script

```bash
cat > /opt/cortex/backup.sh <<'SCRIPT'
#!/bin/bash
set -euo pipefail

# Configuration
BACKUP_DIR="/opt/cortex/backups"
APP_DIR="/opt/cortex/app/server"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cortex-${DATE}.tar.gz.gpg"
PASSPHRASE_FILE="/root/.cortex-backup-key"

mkdir -p "${BACKUP_DIR}"

# Create encrypted backup
# Includes: database, uploads, .env (contains encryption keys)
tar czf - \
  -C "${APP_DIR}" \
  data/ \
  uploads/ \
  .env \
  | gpg --batch --yes --symmetric \
        --cipher-algo AES256 \
        --passphrase-file "${PASSPHRASE_FILE}" \
        -o "${BACKUP_FILE}"

# Set permissions
chmod 600 "${BACKUP_FILE}"

# Delete backups older than retention period
find "${BACKUP_DIR}" -name "cortex-*.tar.gz.gpg" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Backup complete: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
SCRIPT

chmod 700 /opt/cortex/backup.sh
```

### Create Backup Passphrase

```bash
# Generate and store the backup encryption passphrase
openssl rand -base64 32 > /root/.cortex-backup-key
chmod 400 /root/.cortex-backup-key
```

Store a copy of this passphrase somewhere safe and offline. Without it, backups cannot be decrypted.

### Schedule with Cron

```bash
# Daily backup at 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/cortex/backup.sh >> /var/log/cortex-backup.log 2>&1") | crontab -
```

### Restoring from Backup

```bash
# Decrypt
gpg --batch --passphrase-file /root/.cortex-backup-key \
    --decrypt cortex-20260218-030000.tar.gz.gpg \
    | tar xzf - -C /opt/cortex/app/server/

# Restart server
pm2 restart cortex-api
```

### Offsite Backup (Optional)

Copy encrypted backups to a remote location. Since they're GPG-encrypted, they're safe to store on untrusted storage:

```bash
# Rsync to remote server
rsync -az /opt/cortex/backups/ backup-user@remote-server:/backups/cortex/

# Or upload to S3-compatible storage
aws s3 sync /opt/cortex/backups/ s3://your-bucket/cortex-backups/ --storage-class STANDARD_IA
```

---

## 10. Firewall

```bash
# Install UFW
apt install -y ufw

# Default deny incoming, allow outgoing
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (do this first!)
ufw allow ssh

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw enable
ufw status
```

Do **not** expose ports 3000 or 3001 — nginx proxies all traffic.

---

## 11. Maintenance

### Updating Cortex

```bash
su - cortex
cd /opt/cortex/app

git pull origin master

# Rebuild client
cd client && npm run build

# Restart server
pm2 restart cortex-api
pm2 logs cortex-api --lines 20
```

### Locking Down (Shutdown)

To lock the encrypted partition before maintenance or shutdown:

```bash
pm2 stop all
sudo umount /opt/cortex
sudo cryptsetup luksClose cortex-data
```

### Monitoring

```bash
pm2 monit           # Real-time process monitoring
pm2 logs            # All logs
pm2 logs cortex-api --lines 50  # Recent API logs
```

### Log Rotation

PM2 handles its own log rotation. For nginx:

```bash
# Already configured by default at /etc/logrotate.d/nginx
```

---

## Security Summary

| Layer | What It Protects | When It Protects |
|-------|-----------------|------------------|
| **UFW firewall** | Network access | Always (only 22, 80, 443 open) |
| **SSH key-only auth** | Server access | Always |
| **HTTPS (Let's Encrypt)** | Data in transit | All client-server communication |
| **LUKS encryption** | All data on disk | When server is off / partition unmounted |
| **SQLCipher** | Database contents | Even if .db file is copied while mounted |
| **E2EE (app-level)** | Message content | Always — server never sees plaintext messages |
| **Privacy encryption keys** | Metadata (emails, participation, etc.) | At rest in database |
| **GPG encrypted backups** | Backup archives | At rest, in transit, on remote storage |

---

*"The black keeps secrets. So do we."*
