FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:shipping-service

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist/apps/shipping-service ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main"]
