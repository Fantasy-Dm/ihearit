'use strict';
const assert = require('node:assert/strict');
function frames(bytes) {
  assert(bytes.length >= 6 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1, 'Invalid ICO header');
  const count = bytes.readUInt16LE(4), result = [];
  assert(count > 0 && count <= 32 && bytes.length >= 6 + count * 16, 'Invalid ICO directory');
  for (let i = 0; i < count; i++) { const at = 6 + i * 16, size = bytes.readUInt32LE(at + 8), offset = bytes.readUInt32LE(at + 12); assert(offset >= 6 + count * 16 && offset + size <= bytes.length, 'Invalid ICO frame'); result.push({width: bytes[at] || 256, height: bytes[at + 1] || 256, data: bytes.subarray(offset, offset + size)}); }
  return result;
}
function resources(bytes) {
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
  const pe = bytes.readUInt32LE(0x3c); assert.equal(bytes.readUInt32LE(pe), 0x4550);
  const optional = pe + 24, directory = optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96), table = optional + bytes.readUInt16LE(pe + 20), sections = [];
  for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) { const at = table + i * 40; sections.push({rva: bytes.readUInt32LE(at + 12), size: Math.max(bytes.readUInt32LE(at + 8), bytes.readUInt32LE(at + 16)), offset: bytes.readUInt32LE(at + 20)}); }
  const fileOffset = rva => { const section = sections.find(s => rva >= s.rva && rva < s.rva + s.size); assert(section, 'Resource is outside PE sections'); return section.offset + rva - section.rva; };
  const root = fileOffset(bytes.readUInt32LE(directory + 16)), result = [];
  function visit(relative, ids) {
    const at = root + relative, count = bytes.readUInt16LE(at + 12) + bytes.readUInt16LE(at + 14); assert(count <= 1024, 'Invalid resource tree');
    for (let i = 0; i < count; i++) { const entry = at + 16 + i * 8, name = bytes.readUInt32LE(entry), pointer = bytes.readUInt32LE(entry + 4), next = [...ids, name]; if (pointer >>> 31) { assert(next.length <= 3); visit(pointer & 0x7fffffff, next); } else { const leaf = root + pointer, offset = fileOffset(bytes.readUInt32LE(leaf)), size = bytes.readUInt32LE(leaf + 4); assert(offset + size <= bytes.length); result.push({type: next[0], id: next[1], language: next[2], data: bytes.subarray(offset, offset + size)}); } }
  }
  visit(0, []); return result;
}
function verifyEmbeddedIcon(executable, icon) {
  const expected = frames(icon), found = resources(executable), group = found.find(r => r.type === 14); assert(group, 'EXE has no icon group'); assert.equal(group.data.readUInt16LE(4), expected.length, 'EXE icon sizes are incomplete');
  for (let i = 0; i < expected.length; i++) { const at = 6 + 14 * i, id = group.data.readUInt16LE(at + 12), actual = found.find(r => r.type === 3 && r.id === id); assert(actual && actual.data.equals(expected[i].data), 'EXE icon does not match asset at size ' + expected[i].width); }
  return expected.map(f => f.width);
}
module.exports = {frames, verifyEmbeddedIcon};
