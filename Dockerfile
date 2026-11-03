FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 서버에서 PDF를 그리는 데 pdfjs-dist와 @napi-rs/canvas(미리 빌드된 바이너리)가 필요하다. 나머지 의존성은 빼고 설치한다.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
# 공유 편제표 저장소(SQLite)
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
