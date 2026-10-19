#!/usr/bin/env bash
# Render build step: install, collect static files for the Django admin, migrate the database,
# and seed demo data the first time (an empty database).
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input

# Schema changes go over Neon's direct connection: the pooled one (PgBouncer, transaction
# mode) doesn't support the session state migrations rely on. Falls back to DATABASE_URL.
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" python manage.py migrate --no-input
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" python manage.py seed_demo --if-empty
