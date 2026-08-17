# Freat Editz Gateway Production Checklist

## Infrastructure
- [PASS] Next.js 16+ App Router configured.
- [PASS] Supabase PostgreSQL setup with migrations applied.

## Database
- [PASS] Schema migrations applied in order.
- [PASS] Atomic download count increment function (`increment_download_count`) implemented.
- [PASS] Soft-delete (`deleted_at`) implemented and utilized.

## Security
- [PASS] All mutations authenticated via `getAdminClient` (server-side).
- [PASS] Service role used ONLY in server-side actions/API routes.
- [PASS] RLS policies enforced on `downloads` and `download_sessions`.
- [PASS] No hardcoded secrets.
- [PASS] `.env` files not committed.

## Authentication
- [PASS] Admin-only access to `/admin` routes via middleware.

## Public Gateway
- [PASS] Secure `/d/[slug]` route.
- [PASS] Secure `api/download/[slug]` redirect.
- [PASS] Sessions are server-side and secure.
- [PASS] Timed gate enforcement (4000ms delay) server-side.

## UI
- [PASS] Modern, responsive interface.
- [PASS] Reusable `GatewayStep` component.
- [PASS] Proper loading/checked states.
- [PASS] Root page and 404 page implemented.

## Domain
- [PASS] Production URL: https://freateditz.work.gd

## Remaining Issues
- None.

## Deployment Steps
1. Push code to GitHub repository (ensure no secrets).
2. Create Supabase production project and apply migrations in order.
3. Add admin user in Supabase Auth.
4. Import repository in Vercel.
5. Configure Production Environment Variables in Vercel:
   - NEXT_PUBLIC_SUPABASE_URL (from Supabase Project Settings > API)
   - NEXT_PUBLIC_SUPABASE_ANON_KEY (from Supabase Project Settings > API)
   - SUPABASE_SERVICE_ROLE_KEY (from Supabase Project Settings > API)
6. Add `freateditz.work.gd` to Vercel Domains.
7. Add the requested DNS record (CNAME).
8. Verify SSL and HTTPS redirect.
