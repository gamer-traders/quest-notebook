import { expect, test } from 'vitest';
import { embedUrl } from '@shared/embedUrl';
import { embedResponse } from './embedProtocol';

test('an embed address is answered with its HTML, as a page of its own', async () => {
  const html = '<p>hi</p><script>document.title = "ran"</script>';
  const response = embedResponse(embedUrl(html));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  // No policy of the app's: the page's own scripts run, inside the frame's sandbox.
  expect(response.headers.get('content-security-policy')).toBeNull();
  expect(await response.text()).toBe(html);
});

test('an address holding no HTML is not found', () => {
  expect(embedResponse('quest-embed://html/').status).toBe(404);
});
