# Dev-only image for apps/api (T-G0-2). Not hardened/optimized for production —
# docker-compose.dev.yml is local dev infra, see README.md "Local dev environment".
FROM node:24-alpine

RUN corepack enable

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @longrich/api build

ENV NODE_ENV=development
EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
