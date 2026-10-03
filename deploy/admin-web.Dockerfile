FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /src/frontend/admin
COPY frontend/admin/package.json frontend/admin/package-lock.json ./
RUN npm ci
COPY frontend/admin/ ./
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" && SOURCE_COMMIT="$SOURCE_COMMIT" npm run build:production

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/admin/dist/ /usr/share/nginx/html/
EXPOSE 8080
