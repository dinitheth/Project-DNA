/**
 * IdentitySynthesizer — Infers the RepositoryProfile from all analysis data.
 *
 * Determines WHAT the software IS: project type, maturity level,
 * size classification, and infrastructure indicators.
 */

import type { Logger } from '@project-dna/shared';
import type {
  RepositoryDNA,
  FileDNA,
  ArchitectureDNA,
  RepositoryProfile,
  ProjectType,
  RepositorySize,
  LanguageBreakdown,
  FrameworkDetection,
  MaturityIndicators,
} from '@project-dna/dna-core';

export class IdentitySynthesizer {
  constructor(private readonly logger: Logger) {}

  synthesize(
    repository: RepositoryDNA,
    _files: FileDNA[],
    architecture: ArchitectureDNA,
  ): RepositoryProfile {
    this.logger.info('Synthesizing repository identity...');

    const primaryLanguages = this.computeLanguageBreakdown(repository);
    const frameworks = this.detectFrameworks(repository);
    const projectType = this.inferProjectType(repository, architecture);
    const repositorySize = this.classifySize(repository.totalFiles);
    const maturityIndicators = this.assessMaturity(repository);

    return {
      name: this.extractName(repository.rootPath),
      description: this.inferDescription(projectType, primaryLanguages, architecture),
      primaryLanguages,
      frameworks,
      projectType,
      packageManager: repository.packageManager ?? null,
      testFramework: this.detectTestFramework(repository),
      ciSystem: null, // Would need file system access to detect CI configs
      repositorySize,
      maturityIndicators,
    };
  }

  private computeLanguageBreakdown(repository: RepositoryDNA): LanguageBreakdown[] {
    return repository.languages
      .map((lang) => ({
        language: lang.name,
        percentage: Math.round(lang.percentage * 10) / 10,
        fileCount: lang.fileCount,
        linesOfCode: 0, // Not available in RepositoryDNA per-language
      }))
      .sort((a, b) => b.percentage - a.percentage);
  }

  private detectFrameworks(repository: RepositoryDNA): FrameworkDetection[] {
    return repository.frameworks.map((fw) => ({
      name: fw.name,
      version: fw.version ?? null,
      confidence: fw.confidence,
      category: this.categorizeFramework(fw.name) as FrameworkDetection['category'],
    }));
  }

  private categorizeFramework(name: string): string {
    const lower = name.toLowerCase();
    if (['react', 'vue', 'angular', 'svelte', 'next', 'nuxt'].some((f) => lower.includes(f))) return 'frontend';
    if (['express', 'fastify', 'koa', 'nest', 'hono', 'django', 'flask'].some((f) => lower.includes(f))) return 'backend';
    if (['jest', 'vitest', 'mocha', 'cypress', 'playwright'].some((f) => lower.includes(f))) return 'testing';
    if (['webpack', 'vite', 'rollup', 'esbuild', 'turbo'].some((f) => lower.includes(f))) return 'build';
    if (['prisma', 'typeorm', 'sequelize', 'drizzle'].some((f) => lower.includes(f))) return 'orm';
    return 'other';
  }

  private inferProjectType(
    repository: RepositoryDNA,
    architecture: ArchitectureDNA,
  ): ProjectType {
    // Check for monorepo indicators
    const fwNames = repository.frameworks.map((fw) => fw.name.toLowerCase());

    if (fwNames.some((n) => n.includes('turbo') || n.includes('lerna') || n.includes('nx'))) {
      return 'monorepo';
    }

    // Check for server framework → service
    const hasServerIndicators = fwNames.some((n) =>
      ['express', 'fastify', 'koa', 'nest', 'hono'].some((s) => n.includes(s)),
    );
    if (hasServerIndicators) return 'service';

    // Check for frontend framework → application
    const hasFrontendIndicators = fwNames.some((n) =>
      ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt'].some((s) => n.includes(s)),
    );
    if (hasFrontendIndicators) return 'application';

    // Monolith architecture pattern
    if (architecture.pattern === 'monolith') return 'application';

    // Default heuristic
    if (repository.metadata.hasPackageJson) return 'library';

    return 'unknown';
  }

  private classifySize(totalFiles: number): RepositorySize {
    if (totalFiles < 20) return 'tiny';
    if (totalFiles < 100) return 'small';
    if (totalFiles < 500) return 'medium';
    if (totalFiles < 5000) return 'large';
    return 'massive';
  }

  private assessMaturity(repository: RepositoryDNA): MaturityIndicators {
    const fwNames = repository.frameworks.map((fw) => fw.name.toLowerCase());
    return {
      hasCi: false, // Would need file listing to detect .github/workflows etc.
      hasTests: fwNames.some((n) => ['jest', 'vitest', 'mocha', 'cypress', 'playwright'].some((t) => n.includes(t))),
      hasLinting: fwNames.some((n) => n.includes('eslint') || n.includes('prettier')),
      hasDocumentation: repository.metadata.hasReadme,
      hasChangelog: false, // Would need file listing
      hasContributing: false, // Would need file listing
      usesSemver: repository.metadata.version !== undefined,
      hasDocker: false, // Would need file listing
    };
  }

  private detectTestFramework(repository: RepositoryDNA): string | null {
    const fwNames = repository.frameworks.map((fw) => fw.name.toLowerCase());
    if (fwNames.some((n) => n.includes('vitest'))) return 'vitest';
    if (fwNames.some((n) => n.includes('jest'))) return 'jest';
    if (fwNames.some((n) => n.includes('mocha'))) return 'mocha';
    if (fwNames.some((n) => n.includes('cypress'))) return 'cypress';
    if (fwNames.some((n) => n.includes('playwright'))) return 'playwright';
    return null;
  }

  private extractName(rootPath: string): string {
    return rootPath.split(/[/\\]/).filter(Boolean).pop() ?? 'unknown';
  }

  private inferDescription(
    projectType: ProjectType,
    languages: LanguageBreakdown[],
    architecture: ArchitectureDNA,
  ): string {
    const primaryLang = languages[0]?.language ?? 'unknown';
    const typeDescriptions: Record<ProjectType, string> = {
      library: `A ${primaryLang} library`,
      application: `A ${primaryLang} application`,
      monorepo: `A ${primaryLang} monorepo`,
      framework: `A ${primaryLang} framework`,
      'cli-tool': `A ${primaryLang} CLI tool`,
      plugin: `A ${primaryLang} plugin/extension`,
      service: `A ${primaryLang} service`,
      unknown: `A ${primaryLang} project`,
    };

    const base = typeDescriptions[projectType];
    if (architecture.pattern && architecture.pattern !== 'unknown') {
      return `${base} using ${architecture.pattern} architecture`;
    }
    return base;
  }
}
