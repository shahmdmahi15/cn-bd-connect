import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js 16 Official Proxy Engine (Migrated from middleware to proxy in Next.js 16)
 * Handles automatic request rewrites and header forwarding to the NestJS signaling & API backend.
 */
const BACKEND_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export async function proxyRequest(req: NextRequest, path: string): Promise<NextResponse> {
  const url = new URL(req.url);
  const targetUrl = `${BACKEND_URL.replace(/\/$/, '')}/api/${path.replace(/^\//, '')}${url.search}`;

  const headers = new Headers(req.headers);
  headers.set('x-forwarded-host', req.headers.get('host') || '');
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  try {
    const body = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : await req.arrayBuffer();

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`[Proxy Error] Failed to proxy request to ${targetUrl}:`, error);
    return NextResponse.json(
      {
        statusCode: 502,
        message: 'Bad Gateway: Backend signaling service is unreachable',
        error: (error as Error).message,
      },
      { status: 502 },
    );
  }
}

/**
 * Next.js 16 Root Proxy Function
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next.js 16 proxy routing
  if (pathname.startsWith('/api/proxy/')) {
    const subPath = pathname.replace('/api/proxy/', '');
    return proxyRequest(request, subPath);
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: ['/api/proxy/:path*'],
};
