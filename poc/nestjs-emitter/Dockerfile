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

COPY poc/nestjs-emitter/package.json poc/nestjs-emitter/tsconfig.json ./
COPY poc/nestjs-emitter/src ./src

RUN npm pkg set dependencies.@naskot/node-dispatched-tasks=file:./lib && \
    npm install --no-audit --no-fund && \
    npx tsc -p tsconfig.json

CMD ["node", "dist/main.js"]
