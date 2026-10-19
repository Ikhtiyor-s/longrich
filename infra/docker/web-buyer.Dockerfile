# Fly.io deploy image for apps/web-buyer. Same monorepo-aware build pattern as
# infra/docker/api.Dockerfile (whole-repo COPY, frozen-lockfile install, filtered
# build) — no standalone Dockerfile existed for this app before this deploy.
FROM node:24-alpine

RUN corepack enable

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @longrich/web-buyer build

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /repo/apps/web-buyer
EXPOSE 3000

CMD ["pnpm", "start"]
