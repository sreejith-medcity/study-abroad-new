# The portal, as it runs on the VPS.
#
# Three stages so the thing that ends up running is small and holds no build
# tools: dependencies, then the build, then a runner carrying only the
# standalone server Next emits. The migrator is the build stage, kept because
# drizzle-kit lives in the development dependencies and a release has to be
# able to move the schema on.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
# There is no git in this image and .git is not in the build context, so the
# commit the build is stamped with comes in from outside:
#   docker build --build-arg APP_COMMIT=$(git rev-parse --short HEAD) .
# Left empty, next.config.ts falls back to the version number and the time.
ARG APP_COMMIT=""
ENV APP_COMMIT=$APP_COMMIT
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Documents live on a volume mounted here, not in the image.
ENV UPLOAD_DIR=/data/uploads
RUN useradd --system --uid 1001 --create-home portal \
 && mkdir -p /data/uploads && chown -R portal:portal /data
COPY --from=build --chown=portal:portal /app/.next/standalone ./
COPY --from=build --chown=portal:portal /app/.next/static ./.next/static
# This repository has no public/ directory: the favicon and the artwork are
# served from the database, through /api/brand. Nothing to copy.
USER portal
EXPOSE 3000
CMD ["node", "server.js"]
