FROM node:20-alpine
WORKDIR /app
COPY dist/apps/order-service ./dist
COPY node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main"]
