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

# Download assets BEFORE copying all source so this layer is only
# invalidated when assets.json or the download script itself changes —
# not on every source file edit. The script skips already-present files.
COPY examples/assets.json ./examples/
COPY scripts/download-assets.js ./scripts/
RUN node scripts/download-assets.js

# Copy the rest of the source (invalidated on every code change, but fast)
COPY . .

# Build the mkdocs site
RUN node scripts/copy-site-files.js && \
    mkdocs build && \
    node scripts/rename-assets-to-static.js

# Stage 2: Serve with nginx
FROM nginx:alpine

COPY --from=builder /app/site /usr/share/nginx/html

EXPOSE 80
