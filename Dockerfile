FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY scripts/site.mjs ./scripts/site.mjs
COPY site ./site
COPY templates ./templates
RUN npm run site:build

FROM nginx:alpine
LABEL org.opencontainers.image.source="https://github.com/Thanh25102/vibeppt"
LABEL org.opencontainers.image.description="VibePPT public template showcase"
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/site-dist /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
