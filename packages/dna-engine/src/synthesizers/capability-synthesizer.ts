/**
 * CapabilitySynthesizer — Identifies what the software CAN DO.
 *
 * Detects functional capabilities from framework detection,
 * import patterns, naming conventions, and configuration files.
 */

import type { Logger } from '@project-dna/shared';
import type { RepositoryDNA, FileDNA, Capability, CapabilityCategory } from '@project-dna/dna-core';
import { toFileEntityId } from '../utils/entity-id.js';

interface CapabilityRule {
  name: string;
  category: CapabilityCategory;
  description: string;
  indicators: Array<{
    type: 'framework' | 'pattern' | 'import' | 'config' | 'naming';
    match: string | RegExp;
  }>;
}

const CAPABILITY_RULES: CapabilityRule[] = [
  {
    name: 'REST API Serving',
    category: 'api',
    description: 'Exposes REST API endpoints',
    indicators: [
      { type: 'framework', match: 'express' },
      { type: 'framework', match: 'fastify' },
      { type: 'framework', match: 'koa' },
      { type: 'framework', match: 'hono' },
      { type: 'naming', match: /routes?|endpoints?|controllers?/i },
    ],
  },
  {
    name: 'GraphQL API',
    category: 'api',
    description: 'Exposes GraphQL API',
    indicators: [
      { type: 'framework', match: 'graphql' },
      { type: 'framework', match: 'apollo' },
      { type: 'import', match: 'graphql' },
      { type: 'naming', match: /schema\.graphql|resolvers?/i },
    ],
  },
  {
    name: 'SQL Database Access',
    category: 'database',
    description: 'Connects to SQL databases',
    indicators: [
      { type: 'framework', match: 'prisma' },
      { type: 'framework', match: 'typeorm' },
      { type: 'framework', match: 'sequelize' },
      { type: 'framework', match: 'drizzle' },
      { type: 'framework', match: 'knex' },
      { type: 'naming', match: /migrations?|\.sql$/i },
    ],
  },
  {
    name: 'Authentication',
    category: 'authentication',
    description: 'Handles user authentication',
    indicators: [
      { type: 'framework', match: 'passport' },
      { type: 'import', match: 'jsonwebtoken' },
      { type: 'import', match: 'bcrypt' },
      { type: 'naming', match: /auth|login|signup|session/i },
    ],
  },
  {
    name: 'Caching',
    category: 'caching',
    description: 'Implements caching strategies',
    indicators: [
      { type: 'framework', match: 'redis' },
      { type: 'framework', match: 'ioredis' },
      { type: 'import', match: 'lru-cache' },
      { type: 'naming', match: /cache/i },
    ],
  },
  {
    name: 'File Storage',
    category: 'storage',
    description: 'Handles file storage and uploads',
    indicators: [
      { type: 'framework', match: 'multer' },
      { type: 'import', match: '@aws-sdk/client-s3' },
      { type: 'naming', match: /upload|storage|bucket/i },
    ],
  },
  {
    name: 'UI Rendering',
    category: 'ui',
    description: 'Renders user interfaces',
    indicators: [
      { type: 'framework', match: 'react' },
      { type: 'framework', match: 'vue' },
      { type: 'framework', match: 'angular' },
      { type: 'framework', match: 'svelte' },
      { type: 'naming', match: /components?|pages?|views?/i },
    ],
  },
  {
    name: 'Automated Testing',
    category: 'testing',
    description: 'Has automated test infrastructure',
    indicators: [
      { type: 'framework', match: 'jest' },
      { type: 'framework', match: 'vitest' },
      { type: 'framework', match: 'mocha' },
      { type: 'framework', match: 'cypress' },
      { type: 'framework', match: 'playwright' },
    ],
  },
  {
    name: 'Logging',
    category: 'logging',
    description: 'Structured logging',
    indicators: [
      { type: 'framework', match: 'winston' },
      { type: 'framework', match: 'pino' },
      { type: 'framework', match: 'bunyan' },
      { type: 'import', match: 'winston' },
      { type: 'import', match: 'pino' },
    ],
  },
  {
    name: 'Task Scheduling',
    category: 'scheduling',
    description: 'Runs scheduled tasks or cron jobs',
    indicators: [
      { type: 'framework', match: 'bull' },
      { type: 'framework', match: 'agenda' },
      { type: 'import', match: 'node-cron' },
      { type: 'naming', match: /cron|scheduler|worker|queue/i },
    ],
  },
];

export class CapabilitySynthesizer {
  constructor(private readonly logger: Logger) {}

  synthesize(repository: RepositoryDNA, files: FileDNA[]): Capability[] {
    this.logger.info('Detecting software capabilities...');
    const capabilities: Capability[] = [];
    const orderedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
    const filePaths = new Set(orderedFiles.map((file) => file.path));

    for (const rule of CAPABILITY_RULES) {
      const evidence = this.matchRule(rule, repository, orderedFiles);
      if (evidence.length > 0) {
        capabilities.push({
          id: `capability:${rule.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: rule.name,
          category: rule.category,
          description: rule.description,
          confidence: Math.min(1, evidence.length * 0.3),
          evidence,
          implementedBy: Array.from(
            new Set(
              evidence
                .map((item) => item.location)
                .filter((location) => filePaths.has(location))
                .map(toFileEntityId),
            ),
          ),
          detectedAt: Date.now(),
        });
      }
    }

    this.logger.info(`Detected ${capabilities.length} capabilities`);
    return capabilities;
  }

  private matchRule(
    rule: CapabilityRule,
    repository: RepositoryDNA,
    files: FileDNA[],
  ): Capability['evidence'] {
    const evidence: Capability['evidence'] = [];

    for (const indicator of rule.indicators) {
      if (indicator.type === 'framework') {
        const fw = repository.frameworks.find((f) =>
          f.name.toLowerCase().includes(indicator.match as string),
        );
        if (fw) {
          evidence.push({
            type: 'framework',
            indicator: fw.name,
            location: 'package.json',
          });
          for (const file of files) {
            if (file.imports.some((item) => item.source.includes(indicator.match as string))) {
              evidence.push({
                type: 'framework',
                indicator: fw.name,
                location: file.path,
              });
            }
          }
        }
      } else if (indicator.type === 'naming' && indicator.match instanceof RegExp) {
        for (const file of files) {
          if (indicator.match.test(file.path)) {
            evidence.push({
              type: 'naming',
              indicator: file.path.split(/[/\\]/).pop() ?? file.path,
              location: file.path,
            });
          }
        }
      } else if (indicator.type === 'import') {
        for (const file of files) {
          const hasImport = file.imports.some((imp) =>
            imp.source.includes(indicator.match as string),
          );
          if (hasImport) {
            evidence.push({
              type: 'import',
              indicator: indicator.match as string,
              location: file.path,
            });
          }
        }
      }
    }

    const evidenceKeys = new Set<string>();
    return evidence.filter((item) => {
      const key = `${item.type}\0${item.indicator}\0${item.location}`;
      if (evidenceKeys.has(key)) return false;
      evidenceKeys.add(key);
      return true;
    });
  }
}
