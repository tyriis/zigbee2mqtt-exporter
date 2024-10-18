# Multi stage build
#
# npm run build
FROM node:22.10.0-alpine AS build

WORKDIR /app

COPY . .

RUN npm ci
RUN npm run build

# Actual build
FROM node:22.10.0-alpine

COPY --from=build /app/dist /app/dist

WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json
# are copied where available (npm@5+)
ADD package*.json ./

RUN npm ci --production

# switch to user node (uid=1000)
USER node

CMD [ "npm", "run", "service"]
