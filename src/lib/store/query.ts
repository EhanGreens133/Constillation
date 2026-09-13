/**
 * The small subset of Mongo query semantics the application actually uses,
 * evaluated in process. Used by the local JSON backend so that both backends
 * answer identically; the Mongo backend hands these filters to the server.
 */

export type Filter = Record<string, any>;
export type Sort = Record<string, 1 | -1>;
export type UpdateOps = {
  $set?: Record<string, any>;
  $unset?: Record<string, any>;
  $push?: Record<string, any>;
  $pull?: Record<string, any>;
};

export function getPath(doc: any, path: string): any {
  if (doc == null) return undefined;
  if (!path.includes(".")) return doc[path];
  let cur: any = doc;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      // Mongo-style implicit array traversal: collect the field from each element.
      const collected = cur.map((el) => (el == null ? undefined : el[seg]));
      cur = collected.filter((v) => v !== undefined);
      if (cur.length === 0) return undefined;
    } else {
      cur = cur[seg];
    }
  }
  return cur;
}

function setPath(doc: any, path: string, value: any): void {
  const segs = path.split(".");
  let cur = doc;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (cur[s] == null || typeof cur[s] !== "object") cur[s] = {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

function unsetPath(doc: any, path: string): void {
  const segs = path.split(".");
  let cur = doc;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur?.[segs[i]];
    if (cur == null) return;
  }
  delete cur[segs[segs.length - 1]];
}

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function eq(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : a;
    const bt = b instanceof Date ? b.getTime() : b;
    return at === bt;
  }
  return a === b;
}

function matchValue(actual: any, expected: any): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    const keys = Object.keys(expected);
    if (keys.some((k) => k.startsWith("$"))) {
      return keys.every((op) => {
        const want = expected[op];
        switch (op) {
          case "$eq":
            return Array.isArray(actual) ? actual.some((v) => eq(v, want)) : eq(actual, want);
          case "$ne":
            return Array.isArray(actual) ? !actual.some((v) => eq(v, want)) : !eq(actual, want);
          case "$in":
            return Array.isArray(actual)
              ? actual.some((v) => want.some((w: any) => eq(v, w)))
              : want.some((w: any) => eq(actual, w));
          case "$nin":
            return !want.some((w: any) => eq(actual, w));
          case "$gt":
            return actual != null && cmp(actual, want) > 0;
          case "$gte":
            return actual != null && cmp(actual, want) >= 0;
          case "$lt":
            return actual != null && cmp(actual, want) < 0;
          case "$lte":
            return actual != null && cmp(actual, want) <= 0;
          case "$exists":
            return want ? actual !== undefined : actual === undefined;
          case "$regex": {
            const re = want instanceof RegExp ? want : new RegExp(want, expected.$options ?? "");
            return typeof actual === "string" && re.test(actual);
          }
          case "$options":
            return true;
          case "$not":
            return !matchValue(actual, want);
          case "$size":
            return Array.isArray(actual) && actual.length === want;
          default:
            throw new Error(`unsupported query operator: ${op}`);
        }
      });
    }
  }
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((v) => eq(v, expected));
  return eq(actual, expected);
}

export function matches(doc: any, filter: Filter): boolean {
  for (const [key, expected] of Object.entries(filter ?? {})) {
    if (key === "$or") {
      if (!(expected as Filter[]).some((f) => matches(doc, f))) return false;
    } else if (key === "$and") {
      if (!(expected as Filter[]).every((f) => matches(doc, f))) return false;
    } else if (key === "$nor") {
      if ((expected as Filter[]).some((f) => matches(doc, f))) return false;
    } else if (!matchValue(getPath(doc, key), expected)) {
      return false;
    }
  }
  return true;
}

export function sortDocs<T>(docs: T[], sort?: Sort): T[] {
  if (!sort || Object.keys(sort).length === 0) return docs;
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      const c = cmp(getPath(a, field), getPath(b, field));
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

/** Applies $set/$unset/$push/$pull in place. Returns the mutated doc. */
export function applyUpdate<T extends object>(doc: T, ops: UpdateOps): T {
  for (const [path, value] of Object.entries(ops.$set ?? {})) setPath(doc, path, value);
  for (const path of Object.keys(ops.$unset ?? {})) unsetPath(doc, path);
  for (const [path, value] of Object.entries(ops.$push ?? {})) {
    const cur = getPath(doc, path);
    const arr = Array.isArray(cur) ? cur : [];
    if (value && typeof value === "object" && "$each" in value) arr.push(...(value as any).$each);
    else arr.push(value);
    setPath(doc, path, arr);
  }
  for (const [path, value] of Object.entries(ops.$pull ?? {})) {
    const cur = getPath(doc, path);
    if (Array.isArray(cur)) {
      setPath(
        doc,
        path,
        cur.filter((el) => !matchValue(el, value) && !(value && typeof value === "object" && matches(el, value))),
      );
    }
  }
  return doc;
}

/** Only exclusion projections are supported (`{ embedding: 0 }`). */
export function project<T extends object>(doc: T, projection?: Record<string, 0 | 1>): T {
  if (!projection) return doc;
  const excluded = Object.entries(projection).filter(([, v]) => v === 0).map(([k]) => k);
  if (excluded.length === 0) return doc;
  const out: any = { ...doc };
  for (const k of excluded) delete out[k];
  return out;
}
