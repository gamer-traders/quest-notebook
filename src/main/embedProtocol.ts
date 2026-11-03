import { htmlFromEmbedUrl } from '@shared/embedUrl';

/**
 * The answer to an embed's address: the HTML it carries, as a page of its own. It gets no content policy of the
 * app's, so its scripts run; the frame's sandbox keeps it away from the app. Nothing else is ever served.
 */
export function embedResponse(url: string): Response {
  const html = htmlFromEmbedUrl(url);
  if (html === null) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
