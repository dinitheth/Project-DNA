import { describe, expect, it } from 'vitest';
import { FrameworkDetector } from '../detectors/framework-detector.js';

describe('FrameworkDetector', () => {
  it('detects frameworks from all dependency sections', () => {
    const detector = new FrameworkDetector();

    expect(
      detector.detect({
        dependencies: { react: '^18.3.1', express: '^5.0.0' },
        devDependencies: { vite: '^5.4.0' },
      }),
    ).toEqual([
      { name: 'Express', version: '^5.0.0', confidence: 1 },
      { name: 'React', version: '^18.3.1', confidence: 1 },
    ]);
  });
});
