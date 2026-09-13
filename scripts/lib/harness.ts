/** A very small test harness. No dependencies, readable output. */

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function section(name: string): void {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 68 - name.length))}`);
}

export function check(label: string, condition: boolean, detail?: string): boolean {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
  return condition;
}

export function eq<T>(label: string, actual: T, expected: T): boolean {
  return check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function info(message: string): void {
  console.log(`        ${message}`);
}

export function summary(): never {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

/** Points the app at a scratch data directory, with no services configured. */
export function useScratchStore(name: string): string {
  const dir = `.data/test-${name}-${Date.now()}`;
  process.env.DATA_DIR = dir;
  delete process.env.MONGODB_URI;
  process.env.EMBEDDING_PROVIDER = "none";
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-not-used-for-anything-real";
  return dir;
}
