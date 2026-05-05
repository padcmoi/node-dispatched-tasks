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

WORKDIR /build/poc/express-emitter
COPY poc/express-emitter/package.json ./
COPY poc/express-emitter/tsconfig.json ./
RUN npm install --no-audit --no-fund
RUN ln -s /build/poc/express-emitter/node_modules /build/node_modules
COPY poc/express-emitter/src ./src

EXPOSE 3000
CMD ["npm", "run", "start"]
