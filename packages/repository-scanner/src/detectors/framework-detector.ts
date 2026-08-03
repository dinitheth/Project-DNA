/** Framework detection from package-manager metadata. */

import type { JsonRecord } from '../readers/config-reader.js';

export interface FrameworkInfo {
  readonly name: string;
  readonly version?: string;
  readonly confidence: number;
}

const FRAMEWORK_SIGNATURES: Readonly<Record<string, string>> = {
  '@angular/core': 'Angular',
  '@nestjs/core': 'NestJS',
  '@sveltejs/kit': 'SvelteKit',
  '@vue/core': 'Vue',
  express: 'Express',
  fastify: 'Fastify',
  next: 'Next.js',
  nuxt: 'Nuxt',
  react: 'React',
  svelte: 'Svelte',
  vue: 'Vue',
};

export class FrameworkDetector {
  public detect(packageJson: JsonRecord | null): FrameworkInfo[] {
    if (!packageJson) return [];

    const dependencies = {
      ...readStringRecord(packageJson['dependencies']),
      ...readStringRecord(packageJson['devDependencies']),
      ...readStringRecord(packageJson['peerDependencies']),
    };

    const detected = new Map<string, FrameworkInfo>();
    for (const [dependency, version] of Object.entries(dependencies)) {
      const name = FRAMEWORK_SIGNATURES[dependency];
      if (!name) continue;
      detected.set(name, { name, version, confidence: 1 });
    }

    return Array.from(detected.values()).sort((left, right) => left.name.localeCompare(right.name));
  }
}

function readStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
