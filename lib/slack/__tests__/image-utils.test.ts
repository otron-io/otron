import assert from 'node:assert/strict';
import { aspectToSize, normalizeParams } from '../../slack/image-utils.js';

// Parameter normalization tests
(() => {
  // aspect_ratio mapping
  assert.equal(aspectToSize('1:1'), '1024x1024');
  assert.equal(aspectToSize('16:9'), '1792x1024');
  assert.equal(aspectToSize('9:16'), '1024x1792');

  // Defaults
  const p1 = normalizeParams({ prompt: 'hello' });
  assert.equal(p1.size, '1024x1024');
  assert.equal(p1.background, 'white');
  assert.equal(p1.format, 'png');

  // size wins over aspect_ratio
  const p2 = normalizeParams({
    prompt: 'hello',
    size: '512x512',
    aspect_ratio: '16:9',
  });
  assert.equal(p2.size, '512x512');

  // aspect_ratio provides default size if size omitted
  const p3 = normalizeParams({ prompt: 'hello', aspect_ratio: '9:16' });
  assert.equal(p3.size, '1024x1792');
})();

