# School ERP Platform

Ground-up rebuild of the CentEducation multi-tenant school management
platform. Business rules live in `DOCUMENTATION.md`; the legacy-data
migration plan lives in `LEGACY_DATA_MAP.md`.

## Stack

| Layer | Technology |
| --- | --- |
| Backend | Django 5.2 · DRF · SimpleJWT · drf-spectacular · Celery |
| Database | PostgreSQL ≥ 18 (uuidv7 defaults; RLS on the roadmap) |
| Cache/broker | Redis (optional in dev — falls back to in-memory + eager tasks) |
| Frontend | React 19 · TypeScript · Vite · Tailwind v4 · TanStack Query |

## Development

Two PostgreSQL databases run on a local, user-owned cluster (port **5433**):
`school_erp` (the new platform) and `smsys_legacy` (restored production dump,
read-only input for the ETL).

```bash
# 0. Database cluster (once per boot)
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/share/school_management_pg start

# 1. Backend — http://127.0.0.1:8000  (API docs at /api/docs/)
cd backend && uv sync && uv run python manage.py migrate
uv run python manage.py runserver

# 2. Frontend — http://localhost:5173 (proxies /api and /health to Django)
cd frontend && npm install && npm run dev

# Optional: Redis via Docker for real cache/Celery behaviour
docker compose up -d redis   # then set REDIS_URL in backend/.env
```

### Quality gates

```bash
cd backend && uv run ruff check . && uv run pytest   # lint + tests
cd frontend && npm run build                          # type-check + build
```

## Layout

```
backend/
  config/            # settings (base/dev/prod), urls, celery
  apps/
    core/            # BaseModel (UUIDv7, soft delete), tenancy context, LegacyMap
    identity/        # unified Account (role, username), JWT auth, RBAC (growing)
    tenants/         # School + settings + branding (the tenant aggregate)
    audit/           # append-only AuditEvent
frontend/
  src/
    layouts/         # AppShell — responsive sidebar/drawer frame
    pages/           # route pages
    lib/             # API client
```

## Non-negotiable conventions

- Tenant is derived from the authenticated principal, never from request data.
- Soft delete everywhere (`is_active`); default managers hide inactive rows.
- Every financial write is transactional and lands in explicit line tables.
- Every endpoint is versioned (`/api/v1/…`) and typed via the OpenAPI schema.
- Mobile-first: every screen must work at 360 px before it ships.
