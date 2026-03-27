# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY src/frontend/package.json ./
RUN npm install
COPY src/frontend/ ./
RUN npm run build

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/server.js src/
COPY --from=frontend-build /app/dist src/public/
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
