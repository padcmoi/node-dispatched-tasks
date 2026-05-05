FROM node:20-alpine AS lib-build
WORKDIR /lib
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=lib-build /lib/dist /app/lib/dist
COPY --from=lib-build /lib/package.json /app/lib/package.json

COPY poc/nestjs-tasks-owner/package.json poc/nestjs-tasks-owner/tsconfig.json ./
COPY poc/nestjs-tasks-owner/src ./src

# Use the freshly built lib via local file path
RUN npm pkg set dependencies.@naskot/node-dispatched-tasks=file:./lib && \
    npm install --no-audit --no-fund && \
    npx tsc -p tsconfig.json

CMD ["node", "dist/main.js"]
