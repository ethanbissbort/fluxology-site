# Multi-stage Dockerfile for Fluxology Astro Site
# Stage 1: Build the Astro site
# Stage 2: Serve with Apache

# ==============================================
# Build Stage
# ==============================================
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production --ignore-scripts

# Copy source files
COPY . .

# Build the Astro site
RUN npm run build

# ==============================================
# Production Stage
# ==============================================
FROM httpd:2.4-alpine

# Install necessary tools
RUN apk add --no-cache \
    bash \
    curl

# Copy custom Apache configuration
COPY docker/apache/httpd.conf /usr/local/apache2/conf/httpd.conf
COPY docker/apache/vhost.conf /usr/local/apache2/conf/extra/vhost.conf

# Copy built site from builder stage
COPY --from=builder /app/dist /usr/local/apache2/htdocs/

# Set proper permissions
RUN chown -R www-data:www-data /usr/local/apache2/htdocs/ && \
    chmod -R 755 /usr/local/apache2/htdocs/

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Start Apache in foreground
CMD ["httpd-foreground"]
