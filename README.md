# Studio Booking

An appointment booking system for service businesses (salons, clinics, studios). Customers book online, staff run their day from a schedule view, and owners see the business at a glance.

**Live demo:** _coming soon_ · One-click demo logins for customer, staff and owner. No sign-up needed.

![Booking flow](docs/screenshot-booking.png)

## Features

- **Real availability.** Bookable slots are computed from each staff member's weekly hours, existing appointments, time off, minimum notice and how far ahead you can book.
- **No double-booking, guaranteed by the database.** A PostgreSQL exclusion constraint rejects overlapping appointments for the same staff member, even if two requests race past the application check.
- **Time-zone correct.** Everything is stored in UTC. Working hours are wall-clock times in the business time zone, so a 9:00 shift stays at 9:00 across DST changes, and visitors see studio time wherever they are.
- **Three roles**
  - *Customer:* book, view upcoming and past visits, cancel up to a cutoff
  - *Staff:* day-by-day schedule; confirm, complete, mark a no-show or cancel
  - *Owner:* KPIs, a 14-day booking chart, top services, staff load, and every appointment with filters
- **"Any available" staff.** Customers can pick a person or take the first free one.
- **Shareable booking state.** The service, staff, day and slot live in the URL, so the selection survives the login redirect.
- **Django admin** for managing services, staff, working hours and time off.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, TanStack Query, React Router, Tailwind CSS v4 |
| Backend | Django 6, Django REST Framework, SimpleJWT |
| Database | PostgreSQL 17 (`btree_gist` exclusion constraint) |
| Tooling | Docker Compose, GitHub Actions CI, oxlint |

## Architecture

```
React SPA ──/api──▶ Django REST API ──▶ PostgreSQL
  (Vite)              │                    └─ EXCLUDE USING gist (staff WITH =, tstzrange WITH &&)
                      ├─ accounts/      custom User (admin · staff · customer), JWT auth, demo login
                      └─ scheduling/
                           ├─ models.py         Service, StaffMember, WorkingHours, TimeOff, Appointment
                           ├─ availability.py   slot engine (pure function of hours − bookings − time off)
                           ├─ views.py          REST endpoints + role-scoped querysets
                           └─ tests.py          constraint, availability, permissions, cancellation rules
```

### Key decisions

- **Two layers of protection against double-booking.** The API checks availability first so it can return a friendly `409 Conflict`. The database constraint is the real guarantee. When it fires, the `IntegrityError` is turned into the same 409.
- **Availability is computed, not stored.** No pre-generated slot table to keep in sync. Changing someone's hours takes effect immediately.
- **Prices are copied onto each appointment**, so changing a service's price never rewrites revenue history.
- **Role-scoped querysets.** Customers only ever query their own appointments and staff only their own. Admins see everything. Authorization lives in one place, not in every view.

## API overview

| Method | Endpoint | Who |
| --- | --- | --- |
| `GET` | `/api/services/`, `/api/staff/?service=` | public |
| `GET` | `/api/availability/?service=&from=&to=[&staff=]` | public |
| `POST` | `/api/auth/register/`, `/api/auth/login/`, `/api/auth/demo-login/` | public |
| `GET/POST` | `/api/appointments/?scope=upcoming\|past&date=&status=` | signed in (role-scoped) |
| `POST` | `/api/appointments/{id}/cancel/` | owner of the booking (before cutoff), staff, admin |
| `POST` | `/api/appointments/{id}/confirm/` · `complete/` · `no-show/` | staff (own), admin |
| `GET` | `/api/dashboard/` | admin |

## Running locally

Requirements: Python 3.12+, Node 20+, Docker.

```bash
# 1. Database
docker compose up -d

# 2. Backend  (http://localhost:8000)
cd backend
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then set SECRET_KEY
python manage.py migrate
python manage.py seed_demo        # services, staff, customers and ~6 weeks of bookings
python manage.py createsuperuser  # optional, for /admin
python manage.py runserver

# 3. Frontend  (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Run the tests with `python manage.py test` (backend) and `npm run lint && npm run build` (frontend).

`seed_demo` wipes and recreates all demo data, with stable IDs. Schedule it nightly on a public demo so visitors always start from a clean state.

## Roadmap

- [ ] Stripe deposits, where an unpaid booking stays `pending`
- [ ] Email reminders 24 hours before (background worker)
- [ ] Customer rescheduling
- [ ] Staff self-service for working hours and time off
