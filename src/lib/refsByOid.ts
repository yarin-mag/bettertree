import type { BranchInfo, TagInfo } from "./tauri";

export interface CommitRefs {
  branches: string[];
  tags: string[];
}

/** Groups branches/tags by the commit oid they point at, for annotating a commit graph row. */
export function refsByOid(branches: BranchInfo[], tags: TagInfo[]): Map<string, CommitRefs> {
  const map = new Map<string, CommitRefs>();
  const get = (oid: string): CommitRefs => {
    let entry = map.get(oid);
    if (!entry) {
      entry = { branches: [], tags: [] };
      map.set(oid, entry);
    }
    return entry;
  };
  for (const b of branches) get(b.targetOid).branches.push(b.name);
  for (const t of tags) get(t.targetOid).tags.push(t.name);
  return map;
}
