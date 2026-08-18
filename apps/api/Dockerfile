# Multi-stage build per deployment-infrastructure-and-module-schemas.md Section A.5

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY prisma ./prisma

# ---- development target (used by docker-compose for local dev, hot-reload) ----
FROM base AS development
RUN npm install
RUN npx prisma generate
COPY apps/api ./apps/api
EXPOSE 3000
CMD ["npm", "run", "start:dev", "--workspace=apps/api"]

# ---- build stage (used for production image) ----
FROM base AS build
RUN npm ci
COPY apps/api ./apps/api
RUN npx prisma generate
RUN npm run build --workspace=apps/api

# ---- production runtime (slim, what actually deploys to Cloud Run) ----
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
