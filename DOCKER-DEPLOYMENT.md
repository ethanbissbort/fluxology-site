# Docker Deployment Guide

Complete guide for deploying the Fluxology website as a Docker container with Apache.

## 📦 Overview

The deployment uses a **multi-stage Docker build**:
1. **Build Stage**: Node.js Alpine builds the Astro site
2. **Production Stage**: Apache HTTP Server serves the static files

**Technology Stack:**
- Docker multi-stage build
- Apache HTTP Server 2.4 (Alpine)
- Node.js 18 (Alpine) for building
- Optimized for production

## 🚀 Quick Start

### Prerequisites

- Docker 20.10+ installed
- Docker Compose 2.0+ installed
- 2GB free disk space

### Start the Container

```bash
# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The site will be available at: **http://localhost**

## 📁 File Structure

```
fluxology-site/
├── Dockerfile                  # Multi-stage build definition
├── docker-compose.yml          # Container orchestration
├── .env                        # Environment variables
├── .dockerignore              # Build optimization
├── docker/
│   └── apache/
│       ├── httpd.conf         # Main Apache config
│       └── vhost.conf         # Virtual host config
└── logs/
    └── apache/                # Apache logs (mounted)
```

## 🔧 Configuration

### Environment Variables (.env)

```bash
# Port Configuration
HTTP_PORT=80              # Change if port 80 is in use

# Server Configuration
SERVER_NAME=localhost
SERVER_ADMIN=admin@fluxology.ca

# Timezone
TIMEZONE=America/Toronto

# Apache Settings
APACHE_LOG_LEVEL=warn
APACHE_TIMEOUT=300
```

**Change Port Example:**
```bash
# If port 80 is already in use
HTTP_PORT=8080
```

Then access at: http://localhost:8080

### Apache Configuration

**Main Config:** `docker/apache/httpd.conf`
- Compression (gzip)
- Caching headers
- Security headers
- Performance optimizations

**Virtual Host:** `docker/apache/vhost.conf`
- HTTP virtual host (port 80)
- HTTPS virtual host (commented, enable with SSL)
- URL rewriting for SPA

## 🏗️ Building & Running

### Option 1: Docker Compose (Recommended)

```bash
# Build and start
docker-compose up -d --build

# View status
docker-compose ps

# View logs
docker-compose logs -f fluxology-web

# Restart
docker-compose restart

# Stop and remove
docker-compose down

# Stop and remove with volumes
docker-compose down -v
```

### Option 2: Docker Commands

```bash
# Build image
docker build -t fluxology-site:latest .

# Run container
docker run -d \
  --name fluxology-website \
  -p 80:80 \
  --restart unless-stopped \
  fluxology-site:latest

# View logs
docker logs -f fluxology-website

# Stop container
docker stop fluxology-website

# Remove container
docker rm fluxology-website
```

## 🔍 Health Check

The container includes a health check:

```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' fluxology-website

# Should return: healthy
```

**Health Check Details:**
- Interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3
- Start period: 40 seconds

## 📊 Monitoring

### View Logs

```bash
# All logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100 -f

# Specific service
docker-compose logs -f fluxology-web
```

### Apache Server Status

```bash
# Access server status (from inside container)
docker exec fluxology-website curl http://localhost/server-status
```

### Container Stats

```bash
# Real-time stats
docker stats fluxology-website

# One-time stats
docker stats --no-stream fluxology-website
```

## 🔒 Security Features

### HTTP Security Headers

Configured in `httpd.conf`:
- ✅ **X-Frame-Options**: Prevents clickjacking
- ✅ **X-Content-Type-Options**: Prevents MIME sniffing
- ✅ **X-XSS-Protection**: XSS filter enabled
- ✅ **Referrer-Policy**: Controls referrer info
- ✅ **Content-Security-Policy**: Prevents XSS/injection
- ✅ **Permissions-Policy**: Controls browser features

### HTTPS/SSL Setup

To enable HTTPS:

1. **Get SSL Certificates** (Let's Encrypt, commercial CA, etc.)

2. **Place certificates:**
```bash
docker/ssl/
├── fluxology.crt          # Certificate
├── fluxology.key          # Private key
└── ca-bundle.crt          # CA bundle
```

3. **Update docker-compose.yml:**
```yaml
services:
  fluxology-web:
    ports:
      - "80:80"
      - "443:443"      # Add HTTPS port
    volumes:
      - ./docker/ssl:/etc/ssl/certs:ro  # Mount certificates
```

4. **Uncomment HTTPS config** in `docker/apache/vhost.conf`

5. **Rebuild and restart:**
```bash
docker-compose up -d --build
```

### HSTS (HTTP Strict Transport Security)

After SSL is working, enable HSTS in `.env`:
```bash
ENABLE_HSTS=true
HSTS_MAX_AGE=31536000
```

## ⚡ Performance Optimizations

### Caching Strategy

**HTML Files:**
- No cache (always fresh)
- `Cache-Control: no-cache, no-store, must-revalidate`

**Static Assets (CSS, JS, Images, Fonts):**
- 1 year cache
- `Cache-Control: public, max-age=31536000, immutable`
- Assumes hashed filenames from Astro build

**Service Worker:**
- No cache (always fresh)
- `Cache-Control: no-cache`

### Compression

All text-based assets are compressed:
- HTML, CSS, JavaScript
- SVG images
- JSON, XML
- Fonts (except woff2, already compressed)

**Compression Level:** 6 (balance of speed/size)

### Container Size

**Build stages:**
- Builder stage: ~400MB (Node.js + dependencies)
- Final image: ~50-60MB (Apache + built site)

Only the final stage is included in the image!

## 🛠️ Troubleshooting

### Container Won't Start

```bash
# Check if port is in use
sudo lsof -i :80

# Or use a different port in .env
HTTP_PORT=8080

# Check logs for errors
docker-compose logs fluxology-web
```

### Build Fails

```bash
# Clear Docker cache
docker system prune -af

# Rebuild from scratch
docker-compose build --no-cache

# Check disk space
df -h
```

### Site Not Loading

```bash
# Check container is running
docker ps

# Check health status
docker inspect fluxology-website | grep -A 5 Health

# Access container shell
docker exec -it fluxology-website sh

# Test Apache from inside
curl http://localhost/
```

### Permission Errors

```bash
# Ensure proper ownership
docker exec fluxology-website chown -R www-data:www-data /usr/local/apache2/htdocs/

# Check file permissions
docker exec fluxology-website ls -la /usr/local/apache2/htdocs/
```

### High Memory Usage

```bash
# Set memory limit in docker-compose.yml
services:
  fluxology-web:
    mem_limit: 512m
    mem_reservation: 256m
```

## 🔄 Updates & Maintenance

### Update the Website

```bash
# 1. Make changes to source code
# 2. Rebuild and restart
docker-compose up -d --build

# Or without downtime:
docker-compose build
docker-compose up -d --no-deps fluxology-web
```

### Update Base Images

```bash
# Pull latest base images
docker pull node:18-alpine
docker pull httpd:2.4-alpine

# Rebuild
docker-compose build --no-cache
docker-compose up -d
```

### Backup

```bash
# Backup logs
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/

# Backup configuration
tar -czf config-backup-$(date +%Y%m%d).tar.gz docker/ .env

# Backup Docker image
docker save fluxology-site:latest | gzip > fluxology-site-backup-$(date +%Y%m%d).tar.gz
```

## 📈 Production Deployment

### System Requirements

**Minimum:**
- 1 CPU core
- 512 MB RAM
- 5 GB disk space

**Recommended:**
- 2 CPU cores
- 1 GB RAM
- 10 GB disk space

### Environment Setup

1. **Update .env for production:**
```bash
HTTP_PORT=80
HTTPS_PORT=443
SERVER_NAME=fluxology.ca
SERVER_ADMIN=admin@fluxology.ca
NODE_ENV=production
APACHE_LOG_LEVEL=error  # Less verbose in production
```

2. **Configure firewall:**
```bash
# Allow HTTP
sudo ufw allow 80/tcp

# Allow HTTPS
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

3. **Start container:**
```bash
docker-compose up -d
```

4. **Enable auto-restart:**
```yaml
# In docker-compose.yml (already configured)
restart: unless-stopped
```

### Monitoring in Production

**Install monitoring tools:**

```bash
# Prometheus + Grafana
# Add monitoring stack to docker-compose.yml

# Or use Docker built-in
docker stats fluxology-website
```

**Log rotation:**

```bash
# Configure logrotate for docker logs
sudo nano /etc/logrotate.d/docker-containers

# Add:
/var/lib/docker/containers/*/*-json.log {
  rotate 7
  daily
  compress
  size=10M
  missingok
  delaycompress
  copytruncate
}
```

### CI/CD Integration

**Example GitHub Actions:**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build Docker image
        run: docker build -t fluxology-site:latest .

      - name: Deploy to server
        # Add deployment steps here
```

## 🐳 Advanced Docker Commands

### Clean Up

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune -a

# Remove everything (careful!)
docker system prune -a --volumes

# Remove specific image
docker rmi fluxology-site:latest
```

### Debugging

```bash
# Access container shell
docker exec -it fluxology-website sh

# View Apache config
docker exec fluxology-website cat /usr/local/apache2/conf/httpd.conf

# Test Apache config
docker exec fluxology-website apachectl configtest

# Check running processes
docker exec fluxology-website ps aux

# Check disk usage
docker exec fluxology-website df -h
```

### Performance Testing

```bash
# Apache Bench (from host)
ab -n 1000 -c 10 http://localhost/

# Or use hey
hey -n 1000 -c 10 http://localhost/
```

## 📚 Additional Resources

- [Apache HTTP Server Documentation](https://httpd.apache.org/docs/2.4/)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Astro Documentation](https://docs.astro.build/)

## 🆘 Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Review configuration files
- Contact: admin@fluxology.ca

---

**Version:** 2.0.0
**Last Updated:** November 2025
**Status:** Production Ready
