FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/keyrings \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/pgdg.asc \
    && printf '%s\n' 'deb [signed-by=/usr/share/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5=18.6-1.pgdg12+2 \
        postgresql-client-common=293.pgdg12+1 \
        postgresql-client-17=17.11-1.pgdg12+2 \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/requirements.lock /srv/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY app/ /srv/app/
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" \
    && useradd --uid 10001 --create-home adminapi \
    && install -d -o adminapi -g adminapi -m 700 /var/lib/admin-api/backups
ENV BACKUP_DIR=/var/lib/admin-api/backups
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
USER adminapi
WORKDIR /srv/app/services
EXPOSE 5000
# OTPs and rate-limit buckets are process-local; retain one sync worker.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "database:app"]
