# Stage 1: Build the static site
FROM node:22-slim AS builder

# Install Python and pip for mkdocs-material
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install mkdocs-material --break-system-packages

WORKDIR /app

# Install Node deps first (cached layer) — skip prepare hook to avoid Rust/WASM build
# (dist/ with compiled WASM-embedded JS is already committed to the repo)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps

# Copy source
COPY . .

# Download 3D Gaussian Splat example assets (~38 files from sparkjs.dev)
RUN node scripts/download-assets.js

# Build the mkdocs site
RUN node scripts/copy-site-files.js && \
    mkdocs build && \
    node scripts/rename-assets-to-static.js

# Stage 2: Serve with nginx
FROM nginx:alpine

COPY --from=builder /app/site /usr/share/nginx/html

EXPOSE 80
