# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY src/frontend/package.json ./
RUN npm install
COPY src/frontend/ ./
RUN npx vite build --outDir /build/dist

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/server.js src/
COPY --from=frontend-build /build/dist src/public/
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
