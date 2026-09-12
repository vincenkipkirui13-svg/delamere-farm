const test = require('node:test');
const assert = require('node:assert/strict');
const slugify = require('../src/utils/slugify');

test('slugify creates clean URL slugs', () => {
  assert.equal(slugify('Fresh Farm Milk'), 'fresh-farm-milk');
  assert.equal(slugify('  Friesian Cow  '), 'friesian-cow');
});
