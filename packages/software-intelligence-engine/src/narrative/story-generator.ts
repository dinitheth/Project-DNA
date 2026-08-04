/**
 * StoryGenerator — Generates deterministic narrative from structured data.
 *
 * NOT AI-generated prose. Template-driven narrative where every sentence
 * maps to a measurable fact. When AI later joins, it can ENHANCE this
 * story, never REPLACE it.
 */

import type { Logger } from '@project-dna/shared';
import type {
  RepositoryProfile,
  RepositoryHealth,
  ArchitectureDNA,
  CriticalComponent,
  RiskAssessment,
  RepositoryStory,
} from '@project-dna/dna-core';

export class StoryGenerator {
  private static readonly TEMPLATE_VERSION = '1.0.0';

  constructor(private readonly logger: Logger) {}

  generate(
    profile: RepositoryProfile,
    health: RepositoryHealth,
    architecture: ArchitectureDNA,
    criticalComponents: CriticalComponent[],
    risks: RiskAssessment,
    domainCount: number,
  ): RepositoryStory {
    this.logger.info('Generating repository story...');

    return {
      summary: this.generateSummary(profile),
      architectureSummary: this.generateArchitectureSummary(architecture, profile),
      domainSummary: this.generateDomainSummary(domainCount, profile),
      healthSummary: this.generateHealthSummary(health),
      criticalPath: this.generateCriticalPath(criticalComponents),
      risks: this.generateRiskSentences(risks),
      locale: 'en',
      templateVersion: StoryGenerator.TEMPLATE_VERSION,
      generatedAt: Date.now(),
    };
  }

  private generateSummary(profile: RepositoryProfile): string {
    const lang = profile.primaryLanguages[0]?.language ?? 'unknown';
    const langCount = profile.primaryLanguages.length;
    const fwList = profile.frameworks
      .slice(0, 3)
      .map((f) => f.name)
      .join(', ');

    let summary = `${profile.name} is a ${profile.repositorySize} ${profile.projectType}`;
    if (langCount === 1) {
      summary += ` written in ${lang}`;
    } else {
      summary += ` written primarily in ${lang} with ${langCount - 1} additional language${langCount > 2 ? 's' : ''}`;
    }

    if (fwList) {
      summary += `, using ${fwList}`;
    }

    summary += '.';

    if (profile.description && profile.description !== summary) {
      summary += ` ${profile.description}.`;
    }

    return summary;
  }

  private generateArchitectureSummary(
    architecture: ArchitectureDNA,
    _profile: RepositoryProfile,
  ): string {
    const pattern = architecture.pattern;
    const confidence = Math.round(architecture.confidence * 100);
    const layerCount = architecture.layers.length;

    let summary = `Heuristic analysis matched a ${pattern} architecture`;
    if (confidence > 0) {
      summary += ` (${confidence}% heuristic match)`;
    }

    if (layerCount > 0) {
      const layerNames = architecture.layers.map((l) => l.name).join(', ');
      summary += ` with ${layerCount} layer${layerCount > 1 ? 's' : ''}: ${layerNames}`;
    }

    summary += '.';
    return summary;
  }

  private generateDomainSummary(domainCount: number, _profile: RepositoryProfile): string {
    if (domainCount === 0) {
      return 'No distinct business domains were identified. The codebase may be a single-domain application or a library.';
    }
    if (domainCount === 1) {
      return 'The codebase contains 1 identified business domain.';
    }
    return `The codebase contains ${domainCount} identified business domains.`;
  }

  private generateHealthSummary(health: RepositoryHealth): string {
    if (
      health.overallScore === 0 &&
      Object.values(health.dimensions).every((dimension) => dimension === 0)
    ) {
      return 'Heuristic health is unavailable because no source files were parsed.';
    }

    const score = health.overallScore;
    let rating: string;

    if (score >= 85) rating = 'excellent';
    else if (score >= 70) rating = 'good';
    else if (score >= 50) rating = 'fair';
    else if (score >= 30) rating = 'poor';
    else rating = 'critical';

    let summary = `Heuristic health: ${score}/100 (${rating}).`;

    // Find the weakest dimension
    const dims = health.dimensions;
    const dimEntries = Object.entries(dims) as Array<[string, number]>;
    dimEntries.sort((a, b) => a[1] - b[1]);
    const weakest = dimEntries[0];

    if (weakest && weakest[1] < 60) {
      const dimName = weakest[0]
        .replace(/Health$/, '')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase();
      summary += ` Key concern: the ${dimName} heuristic signal is ${weakest[1]}/100.`;
    }

    return summary;
  }

  private generateCriticalPath(components: CriticalComponent[]): string {
    const critical = components.filter((c) => c.criticality === 'critical');
    if (critical.length === 0) {
      return 'No critical-severity components were identified.';
    }

    const names = critical
      .slice(0, 5)
      .map((c) => c.name)
      .join(' -> ');
    return `The critical path runs through ${critical.length} component${critical.length > 1 ? 's' : ''}: ${names}.`;
  }

  private generateRiskSentences(risks: RiskAssessment): string[] {
    const sentences: string[] = [];

    if (risks.totalRisks === 0) {
      sentences.push('No risks were detected.');
      return sentences;
    }

    sentences.push(
      `${risks.totalRisks} risk${risks.totalRisks > 1 ? 's' : ''} detected (risk exposure: ${risks.overallRiskScore}/100).`,
    );

    if (risks.bySeverity.critical > 0) {
      sentences.push(
        `${risks.bySeverity.critical} critical-severity risk${risks.bySeverity.critical > 1 ? 's' : ''} require${risks.bySeverity.critical === 1 ? 's' : ''} immediate attention.`,
      );
    }

    if (risks.bySeverity.high > 0) {
      sentences.push(
        `${risks.bySeverity.high} high-severity risk${risks.bySeverity.high > 1 ? 's' : ''} should be addressed in the near term.`,
      );
    }

    // Top risk details
    for (const risk of risks.topRisks.slice(0, 3)) {
      sentences.push(
        `${risk.severity.toUpperCase()}: ${risk.description} (affects ${risk.affectedEntityCount} file${risk.affectedEntityCount > 1 ? 's' : ''}).`,
      );
    }

    return sentences;
  }
}
