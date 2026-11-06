import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeNodes, removeSource, replaceSourceNodes } = require('./node-registry.cjs');

const baseNode = {
  id: 'node-1', type: 'vless', name: 'Tokyo', server: 'example.com', server_port: 443,
  uuid: '00000000-0000-4000-8000-000000000001', tls: { enabled: true, server_name: 'example.com' },
};

test('mergeNodes records multiple origins without changing the stable node id', () => {
  const first = mergeNodes([], [baseNode], 'clipboard');
  const second = mergeNodes(first.nodes, [{ ...baseNode, id: 'new-id', name: 'Tokyo renamed' }], 'subscription:abc');
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.nodes[0].id, 'node-1');
  assert.deepEqual(second.nodes[0].sources, ['clipboard', 'subscription:abc']);
});

test('removeSource retains a node still referenced by another origin', () => {
  const merged = mergeNodes([], [baseNode], 'clipboard');
  const both = mergeNodes(merged.nodes, [baseNode], 'subscription:abc');
  const retained = removeSource(both.nodes, 'subscription:abc');
  assert.equal(retained.length, 1);
  assert.deepEqual(retained[0].sources, ['clipboard']);
  assert.equal(removeSource(retained, 'clipboard').length, 0);
});


test('subscription sync is atomic when any row cannot be parsed', () => {
  const current = mergeNodes([], [baseNode], 'subscription:abc').nodes;
  const result = replaceSourceNodes(current, [{ ...baseNode, name: 'new name' }], 'subscription:abc', [{ line: 2, message: 'unsupported' }]);
  assert.equal(result.preserved, true);
  assert.equal(result.nodes[0].name, 'Tokyo');
  assert.equal(result.nodes[0].sources.includes('subscription:abc'), true);
});


test('subscription refresh keeps stable node IDs and added timestamps', () => {
  const first = mergeNodes([], [baseNode], 'subscription:abc').nodes;
  const originalId = first[0].id;
  const originalAddedAt = first[0].addedAt;
  const refreshed = replaceSourceNodes(first, [{ ...baseNode, id: 'temporary-new-id', name: 'Tokyo updated' }], 'subscription:abc');
  assert.equal(refreshed.nodes.length, 1);
  assert.equal(refreshed.nodes[0].id, originalId);
  assert.equal(refreshed.nodes[0].addedAt, originalAddedAt);
  assert.equal(refreshed.nodes[0].name, 'Tokyo updated');
  assert.equal(refreshed.added, 0);
  assert.equal(refreshed.updated, 1);
});

test('subscription sync replaces only the selected subscription source', () => {
  const manual = mergeNodes([], [baseNode], 'clipboard').nodes;
  const withSubscription = mergeNodes(manual, [baseNode], 'subscription:abc').nodes;
  const next = replaceSourceNodes(withSubscription, [{ ...baseNode, name: 'Tokyo 2' }], 'subscription:abc');
  assert.equal(next.preserved, false);
  assert.equal(next.nodes.length, 1);
  assert.equal(next.nodes[0].name, 'Tokyo 2');
  assert.deepEqual(next.nodes[0].sources, ['clipboard', 'subscription:abc']);
});

test('subscription refresh removes stale subscription-only nodes but keeps stable IDs', () => {
  const stale = { ...baseNode, id: 'stale-node', name: 'Old node', server: 'old.example.com' };
  const first = mergeNodes([], [baseNode, stale], 'subscription:abc').nodes;
  const originalId = first.find((node) => node.server === baseNode.server).id;
  const refreshed = replaceSourceNodes(first, [{ ...baseNode, id: 'temp-id', name: 'Tokyo refreshed' }], 'subscription:abc');
  assert.equal(refreshed.nodes.length, 1);
  assert.equal(refreshed.nodes[0].id, originalId);
  assert.equal(refreshed.nodes[0].name, 'Tokyo refreshed');
});
