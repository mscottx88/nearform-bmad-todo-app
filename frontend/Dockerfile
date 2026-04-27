# syntax=docker/dockerfile:1.7
#
# Pond Todo frontend image (production-style: nginx serving the
# Vite build, with /api/* proxied to the backend compose service).
#
# Build:
#   docker build -t pond-frontend frontend/
#
# Run (standalone):
#   docker run --rm -p 8080:80 pond-frontend
#
# In docker-compose, the `backend` service hostname resolves to the
# backend container; nginx.conf proxies /api/ → http://backend:8000/api/.

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first for cache-friendly install layer.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + Vite/TS configs and build.
COPY . .
RUN npm run build


# ---------- Stage 2: serve ----------
FROM nginx:alpine AS serve

# Drop the stock nginx config; ours handles SPA fallback + /api/ proxy.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built bundle.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
