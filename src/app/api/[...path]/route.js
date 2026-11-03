import serverless from 'serverless-http';
import app from '../../../../server/index.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = serverless(app);

async function handle(request) {
  const url = new URL(request.url);
  const contentType = request.headers.get('content-type') || '';
  const isText = /^(text\/|application\/(?:json|[^;]+\+json|x-www-form-urlencoded))/i.test(contentType);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = !hasBody ? null : isText ? await request.text() : Buffer.from(await request.arrayBuffer()).toString('base64');
  const sourceIp = request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const result = await handler({
    httpMethod: request.method,
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    multiValueQueryStringParameters: Object.fromEntries([...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)])),
    headers: Object.fromEntries(request.headers),
    requestContext: { identity: { sourceIp } },
    body,
    isBase64Encoded: hasBody && !isText,
  }, {});
  const headers = new Headers(result.headers);
  for (const [key, values] of Object.entries(result.multiValueHeaders || {})) {
    headers.delete(key);
    for (const value of values) headers.append(key, value);
  }
  const data = result.isBase64Encoded ? Buffer.from(result.body || '', 'base64') : result.body;
  return new Response([204, 205, 304].includes(result.statusCode) ? null : data, { status: result.statusCode, headers });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as PUT };
