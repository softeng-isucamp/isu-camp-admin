FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && printf '%s\n' \
        'Types: deb' \
        'URIs: https://apt.postgresql.org/pub/repos/apt' \
        'Suites: bookworm-pgdg' \
        'Components: main' \
        'Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc' \
        > /etc/apt/sources.list.d/pgdg.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/requirements.lock /srv/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY app/ /srv/app/
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" \
    && groupadd --gid 10001 adminapi \
    && useradd --uid 10001 --gid 10001 --create-home adminapi \
    && install -d -o 10001 -g 10001 -m 0750 /srv/backups
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
USER adminapi
WORKDIR /srv/app/services
EXPOSE 5000
# OTPs, rate-limit buckets, backup jobs and the backup scheduler are
# process-local, so keep one process. Its threads let requests overlap: each
# one mostly waits on the remote database, and a single sync worker made every
# request queue behind the one before it. The shared state is lock-guarded.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--worker-class", "gthread", "--threads", "4", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "database:app"]
