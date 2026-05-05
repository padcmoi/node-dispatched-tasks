# Build context = repo root (parent of poc/).
# We mirror the on-disk layout so `"@naskot/node-dispatched-tasks": "file:../.."` resolves correctly:
#   /build                         (= the lib root)
#   /build/poc/nestjs-tasks-owner  (= this app)

FROM node:24-alpine AS lib-build
WORKDIR /build
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /build
COPY --from=lib-build /build/package.json ./package.json
COPY --from=lib-build /build/dist ./dist

WORKDIR /build/poc/nestjs-tasks-owner
COPY poc/nestjs-tasks-owner/package.json ./
COPY poc/nestjs-tasks-owner/tsconfig.json ./
RUN npm install --no-audit --no-fund
# Dedupe peer deps (typeorm/ioredis/zod): expose the POC's node_modules at the lib root
# so the lib's bundled CJS at /build/dist/index.cjs and its .d.ts both resolve them
# from the same single install (avoids duplicate-version type conflicts).
RUN ln -s /build/poc/nestjs-tasks-owner/node_modules /build/node_modules
COPY poc/nestjs-tasks-owner/src ./src
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
