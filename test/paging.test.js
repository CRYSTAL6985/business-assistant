const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePaging, pageResult, likePattern } = require('../src/paging');

test('paging clamps per to 1..100 and page to >= 1', () => {
  assert.deepEqual(parsePaging({}), { page: 1, per: 20, offset: 0 });
  assert.deepEqual(parsePaging({ page: '3', per: '10' }), { page: 3, per: 10, offset: 20 });
  assert.deepEqual(parsePaging({ page: '-1', per: '100000' }), { page: 1, per: 100, offset: 0 });
  assert.deepEqual(parsePaging({ page: 'x', per: '0' }), { page: 1, per: 1, offset: 0 });
});

test('pageResult reports total pages', () => {
  assert.deepEqual(pageResult(['a'], 41, { page: 2, per: 20 }), { items: ['a'], total: 41, page: 2, pages: 3 });
  assert.deepEqual(pageResult([], 0, { page: 1, per: 20 }), { items: [], total: 0, page: 1, pages: 1 });
});

test('likePattern escapes % and _ so they match literally', () => {
  assert.equal(likePattern('50%_off'), '%50\\%\\_off%');
  assert.equal(likePattern('a\\b'), '%a\\\\b%');
});
