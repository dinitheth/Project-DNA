import { describe, expect, it } from 'vitest';
import { LanguageDetector } from '../detectors/language-detector.js';

describe('LanguageDetector', () => {
  it('aggregates supported source files and ignores unknown extensions', () => {
    const detector = new LanguageDetector();

    expect(
      detector.detect(['src/index.ts', 'src/App.tsx', 'scripts/tool.py', 'README.md']),
    ).toEqual([
      { id: 'python', name: 'Python', fileCount: 1, percentage: 33.33 },
      { id: 'typescript', name: 'TypeScript', fileCount: 1, percentage: 33.33 },
      { id: 'typescriptreact', name: 'TypeScript React', fileCount: 1, percentage: 33.33 },
    ]);
  });
});
