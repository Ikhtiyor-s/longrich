# Dev-only image for the apps/api worker entrypoint (T-G0-2). Same codebase and
# build output as infra/docker/api.Dockerfile per docs/architecture/repo-structure.md
# ("the same image... simply points its CMD/entrypoint at worker.main.ts instead
# of main.ts") — kept as a separate Dockerfile (not a compose `command:` override)
# because that doc specifies this file explicitly.
FROM node:24-alpine

RUN corepack enable

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @longrich/api build

ENV NODE_ENV=development

CMD ["node", "apps/api/dist/worker.main.js"]
