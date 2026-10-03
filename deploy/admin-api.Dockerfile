FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY deploy/requirements.lock /srv/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY app/ /srv/app/
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" && useradd --uid 10001 --create-home adminapi
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
USER adminapi
WORKDIR /srv/app/services
EXPOSE 5000
# OTPs and rate-limit buckets are process-local; retain one sync worker.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "database:app"]
