import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

test('starter page has a root mount point and application entry', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="root"/);
  assert.match(html, /src="\/src\/main\.jsx"/);
});