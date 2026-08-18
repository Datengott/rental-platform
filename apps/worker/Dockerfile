# Runs the background jobs: rent-expiry reminder scheduler (schema doc Section B.7),
# payment reconciliation (API spec Section 7), notification dispatch queue.

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY apps/worker/package*.json ./apps/worker/
COPY prisma ./prisma

FROM base AS development
RUN npm install
RUN npx prisma generate
COPY apps/worker ./apps/worker
CMD ["npm", "run", "start:dev", "--workspace=apps/worker"]

FROM base AS build
RUN npm ci
COPY apps/worker ./apps/worker
RUN npx prisma generate
RUN npm run build --workspace=apps/worker

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/prisma ./prisma
CMD ["node", "apps/worker/dist/main.js"]
