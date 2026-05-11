FROM --platform=${BUILDPLATFORM} node:24-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ sqlite-dev

COPY package.json package-lock.json ./
RUN npm i

COPY . ./
RUN npm run build

FROM node:24-alpine AS final
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

ENTRYPOINT [ "npm", "run", "start" ]
