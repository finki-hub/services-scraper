FROM --platform=${BUILDPLATFORM} node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build && npm prune --production

FROM node:26-alpine AS final
WORKDIR /app

ARG APP_REVISION
ENV APP_REVISION=${APP_REVISION}

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENTRYPOINT [ "npm", "run", "start" ]
