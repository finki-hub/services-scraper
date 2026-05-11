FROM node:24-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
RUN test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node

COPY . ./
RUN npm run build

FROM node:24-slim AS final
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENTRYPOINT [ "npm", "run", "start" ]
