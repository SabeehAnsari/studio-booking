#!/usr/bin/env bash
# Render build step: install, collect static files for the Django admin, migrate the database,
# and seed demo data the first time (an empty database).
set -o errexit

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
python manage.py seed_demo --if-empty
