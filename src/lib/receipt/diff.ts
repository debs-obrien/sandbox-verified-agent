/** Minimal unified diff for short source files (no external deps). */

export function unifiedDiff(
  path: string,
  before: string,
  after: string,
): string {
  if (before === after) {
    return `--- a/${path}\n+++ b/${path}\n(no changes)\n`;
  }

  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`, `@@`];

  // Line-oriented LCS-ish presentation for small files.
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
    } else {
      if (left !== undefined) lines.push(`-${left}`);
      if (right !== undefined) lines.push(`+${right}`);
    }
  }
  return lines.join("\n") + "\n";
}
