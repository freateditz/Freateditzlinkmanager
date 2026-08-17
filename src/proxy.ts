// Next.js 16 Proxy (formerly Middleware). One authoritative auth/session mechanism.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  // Build a mutable response that we'll attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // CRITICAL: must write to BOTH request.cookies and response.cookies
        // so downstream Server Components and the next request see the same session.
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // IMPORTANT: getUser() validates the JWT against Supabase Auth and refreshes
  // tokens when needed. getSession() does not validate — it only reads cookies.
  // Using getUser() is what causes cookies to be re-written when the access token
  // is near expiry, which fixes the "session lost on refresh" symptom.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith('/admin');
  const isLoginRoute = pathname === '/admin/login';

  if (isAdminRoute && !isLoginRoute && !user) {
    const url = new URL('/admin/login', request.url);
    if (pathname !== '/admin') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute && user) {
    const next = request.nextUrl.searchParams.get('next');
    return NextResponse.redirect(new URL(next && next.startsWith('/admin') ? next : '/admin', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*'],
};
