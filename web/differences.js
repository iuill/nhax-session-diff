// Group explicitly typed XML array elements for display only.
// The original difference report remains unchanged for export.
export function groupDifferences(rows) {
  const result = [], arrays = new Map();
  for (const row of rows) {
    const match = row.path.match(/^(.*)\/((?:\{[^}]+\})?(?:byte|unsignedByte|sbyte|double|float|decimal|int|integer|short|long|unsignedInt|unsignedShort|unsignedLong|boolean))\[(\d+)\]\/#text$/i);
    if (!match) { result.push(row); continue; }
    const [, path, element, position] = match;
    const key = JSON.stringify([row.side, path, element]);
    let array = arrays.get(key);
    if (!array) {
      array = { ...row, path, change: 'changed', arrayType: element, elements: [] };
      arrays.set(key, array); result.push(array);
    }
    array.elements.push({ ...row, position: Number(position) });
  }
  for (const row of arrays.values()) {
    row.elements.sort((a, b) => a.position - b.position);
    for (const field of ['before', 'after']) {
      row[field] = row.elements.slice(0, 3).map(e => `[${e.position}] ${e[field] ?? '—'}`).join(' · ')
        + (row.elements.length > 3 ? ' …' : '');
    }
  }
  return result;
}
