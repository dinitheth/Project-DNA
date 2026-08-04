/** Returns the canonical DNAObject identifier for a repository file path. */
export function toFileEntityId(filePath: string): string {
  return `file:${filePath}`;
}
