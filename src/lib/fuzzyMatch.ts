export function fuzzyMatch(query: string, target: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function rankMatches<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  const substringMatches: T[] = [];
  const fuzzyOnlyMatches: T[] = [];
  for (const item of items) {
    const text = getText(item);
    if (text.toLowerCase().includes(q)) {
      substringMatches.push(item);
    } else if (fuzzyMatch(query, text)) {
      fuzzyOnlyMatches.push(item);
    }
  }
  return [...substringMatches, ...fuzzyOnlyMatches];
}
