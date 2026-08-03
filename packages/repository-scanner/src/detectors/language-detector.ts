/** Deterministic programming-language detection based on file names and extensions. */

import path from 'node:path';

export interface LanguageInfo {
  readonly id: string;
  readonly name: string;
  readonly fileCount: number;
  readonly percentage: number;
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, { id: string; name: string }>> = {
  '.ts': { id: 'typescript', name: 'TypeScript' },
  '.tsx': { id: 'typescriptreact', name: 'TypeScript React' },
  '.js': { id: 'javascript', name: 'JavaScript' },
  '.jsx': { id: 'javascriptreact', name: 'JavaScript React' },
  '.mjs': { id: 'javascript', name: 'JavaScript' },
  '.cjs': { id: 'javascript', name: 'JavaScript' },
  '.py': { id: 'python', name: 'Python' },
  '.java': { id: 'java', name: 'Java' },
  '.cs': { id: 'csharp', name: 'C#' },
  '.go': { id: 'go', name: 'Go' },
  '.rs': { id: 'rust', name: 'Rust' },
  '.rb': { id: 'ruby', name: 'Ruby' },
  '.php': { id: 'php', name: 'PHP' },
  '.swift': { id: 'swift', name: 'Swift' },
  '.kt': { id: 'kotlin', name: 'Kotlin' },
  '.kts': { id: 'kotlin', name: 'Kotlin' },
  '.cpp': { id: 'cpp', name: 'C++' },
  '.cc': { id: 'cpp', name: 'C++' },
  '.cxx': { id: 'cpp', name: 'C++' },
  '.hpp': { id: 'cpp', name: 'C++' },
  '.h': { id: 'c', name: 'C' },
  '.c': { id: 'c', name: 'C' },
};

export class LanguageDetector {
  public detect(filePaths: readonly string[]): LanguageInfo[] {
    const counts = new Map<string, { name: string; count: number }>();

    for (const filePath of filePaths) {
      const language = this.detectFile(filePath);
      if (!language) continue;
      const current = counts.get(language.id);
      counts.set(language.id, { name: language.name, count: (current?.count ?? 0) + 1 });
    }

    const total = Array.from(counts.values()).reduce((sum, entry) => sum + entry.count, 0);
    return Array.from(counts.entries())
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        fileCount: entry.count,
        percentage: total === 0 ? 0 : Number(((entry.count / total) * 100).toFixed(2)),
      }))
      .sort(
        (left, right) => right.fileCount - left.fileCount || left.name.localeCompare(right.name),
      );
  }

  public detectFile(filePath: string): { id: string; name: string } | null {
    return LANGUAGE_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null;
  }
}
