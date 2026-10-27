/**
 * Session refresh, and a cheap first gate on /admin.
 *
 * Supabase access tokens are short-lived. Without a refresh on each request,
 * a reviewer working through a queue is signed out mid-decision, so this runs
 * on every matched path and writes any rotated cookies onto the response.
 *
 * The redirect here is convenience, not security. It saves an unauthenticated
 * visitor a pointless page render; it decides nothing. Every admin page
 * re-resolves the user and checks the market role server-side, because
 * middleware runs before routing and cannot know which market a request is
 * really for (ADR-002).
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Misconfiguration must not read as "signed out". Let the request through
    // and let the page's own check fail loudly with a usable message.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Revalidates the token with Supabase and rotates the cookies if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/admin')) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/login';
    signIn.search = '';
    // Only ever a path on this origin, never a caller-supplied absolute URL:
    // a "next" parameter taken at face value is an open redirect.
    signIn.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  // Only where a session matters. getUser() is a network round trip to
  // Supabase, so matching every path would put an auth call in front of every
  // public venue page — pages that have no signed-in user and want none.
  matcher: ['/admin', '/admin/:path*', '/login'],
};
