'use strict';

const crypto = require('node:crypto');
const { nodeFingerprint } = require('./node-parser.cjs');

function getSources(node) {
  const values = Array.isArray(node?.sources) ? node.sources : (node?.source ? [node.source] : []);
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function mergeNodes(existing, incoming, source) {
  const byFingerprint = new Map(existing.map((node) => [nodeFingerprint(node), node]));
  let added = 0;
  let updated = 0;

  for (const node of incoming) {
    const fingerprint = nodeFingerprint(node);
    const old = byFingerprint.get(fingerprint);
    const sources = new Set(getSources(old));
    if (source) sources.add(source);
    const record = {
      ...node,
      id: old?.id || node.id || crypto.randomUUID(),
      source: getSources(old)[0] || source || node.source || 'clipboard',
      sources: [...sources],
      addedAt: old?.addedAt || new Date().toISOString(),
    };
    if (old) updated++;
    else added++;
    byFingerprint.set(fingerprint, record);
  }

  return { nodes: [...byFingerprint.values()], added, updated };
}

function removeSource(nodes, source) {
  return nodes.flatMap((node) => {
    const sources = getSources(node).filter((item) => item !== source);
    if (sources.length === 0) return [];
    return [{ ...node, sources, source: sources[0] }];
  });
}

function replaceSourceNodes(existing, incoming, source, parseErrors = []) {
  if (parseErrors.length > 0) {
    return { nodes: existing, added: 0, updated: 0, preserved: true };
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw new Error('订阅没有可应用的节点；原有节点已保留');
  }

  const originalByFingerprint = new Map(existing.map((node) => [nodeFingerprint(node), node]));
  const retained = removeSource(existing, source);
  const merged = mergeNodes(retained, incoming, source);
  const nodes = merged.nodes.map((node) => {
    const previous = originalByFingerprint.get(nodeFingerprint(node));
    if (!previous || previous.id === node.id) return node;
    // A node supplied only by this subscription disappears from `retained` during
    // replacement. Preserve its stable ID and addedAt instead of treating every
    // refresh as a delete + re-add operation.
    return { ...node, id: previous.id, addedAt: previous.addedAt || node.addedAt };
  });
  const uniqueIncoming = new Map(incoming.map((node) => [nodeFingerprint(node), node]));
  const added = [...uniqueIncoming.keys()].filter((fingerprint) => !originalByFingerprint.has(fingerprint)).length;
  const updated = uniqueIncoming.size - added;
  return { nodes, added, updated, preserved: false };
}

module.exports = { mergeNodes, removeSource, replaceSourceNodes, getSources };
