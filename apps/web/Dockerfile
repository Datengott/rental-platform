# Mirrors apps/api/Dockerfile's shape for consistency, but this app has no
# Prisma/DB access at all — it only calls the api over HTTP.

FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/

# --ignore-scripts: the root package.json's own "postinstall" runs `prisma
# generate`, which needs the prisma/ directory this image deliberately
# never copies in (this service has no DB access at all).

# ---- development target (used by docker-compose for local dev, hot-reload) ----
FROM base AS development
RUN npm install --ignore-scripts
COPY apps/web ./apps/web
EXPOSE 3001
CMD ["npm", "run", "dev", "--workspace=apps/web"]

# ---- build stage (used for production image) ----
FROM base AS build
RUN npm ci --ignore-scripts
COPY apps/web ./apps/web
RUN npm run build --workspace=apps/web

# ---- production runtime ----
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace=apps/web"]
