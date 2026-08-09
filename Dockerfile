# Multi-stage Dockerfile for Fluxology Astro Site
# Stage 1: Build the Astro site
# Stage 2: Serve with Apache

# ==============================================
# Build Stage
# ==============================================
# Astro 7 requires Node >= 22.12.
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (the build needs devDependencies such as terser
# and typescript). --ignore-scripts keeps install hardened; the toolchain
# (Rolldown/Vite/terser) delivers native binaries via optionalDependencies,
# not lifecycle scripts, so the build does not need them.
RUN npm ci --ignore-scripts

# Copy source files
COPY . .

# Build the Astro site
RUN npm run build

# Normalise modes here, in the stage that gets thrown away, so the production
# stage needs no metadata pass of its own: files read-only, directories
# traversable. u=rwX/go=rX sets the execute bit on directories only.
RUN chmod -R u=rwX,go=rX /app/dist

# ==============================================
# Production Stage
# ==============================================
FROM httpd:2.4-alpine

# Install necessary tools. Only curl: it is what the HEALTHCHECK below runs.
# `bash` used to be installed here and nothing invoked it — httpd-foreground is
# a /bin/sh script, there are no scripts under docker/, and both the healthcheck
# and CMD are exec-form.
RUN apk add --no-cache curl

# Copy custom Apache configuration
COPY docker/apache/httpd.conf /usr/local/apache2/conf/httpd.conf
COPY docker/apache/vhost.conf /usr/local/apache2/conf/extra/vhost.conf

# Copy built site from builder stage.
#
# --chown/--chmod on the COPY itself, rather than a `RUN chown -R … && chmod -R`
# afterwards. Two reasons:
#   * The serving user must not own its own document root. httpd.conf runs
#     worker children as `User www-data`; the previous recipe gave that uid
#     ownership plus write permission on every file it serves, and marked every
#     static file 0755 (world-executable). Read-only for www-data is all Apache
#     needs, and it is what the rest of this config (Options -Indexes, the CSP,
#     no CGI/DAV/upload path) assumes about a static origin.
#   * A metadata change in a later layer copies the whole tree again through
#     overlayfs, so the image carried ~7 MB of dist twice and invalidated that
#     layer on every build.
# The modes themselves are normalised in the builder stage (see `chmod -R`
# there), which is discarded — so this image gets one clean copy at the right
# ownership and nothing further touches it.
COPY --from=builder --chown=root:www-data /app/dist /usr/local/apache2/htdocs/

# Expose the app port (Apache listens on 6080 — see docker/apache/httpd.conf;
# a non-default port avoids collisions with other containers)
EXPOSE 6080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:6080/ || exit 1

# Start Apache in foreground
CMD ["httpd-foreground"]
