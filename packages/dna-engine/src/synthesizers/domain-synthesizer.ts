/**
 * DomainSynthesizer — Groups modules into inferred BusinessDomains.
 *
 * Uses folder structure and naming conventions to cluster files
 * into logical business domains. Enriches DNAObjects with domain membership.
 */

import type { Logger } from '@project-dna/shared';
import type { FileDNA, DNAObject, BusinessDomain } from '@project-dna/dna-core';

export class DomainSynthesizer {
  constructor(private readonly logger: Logger) {}

  /**
   * Infer business domains from file structure and enrich entities.
   * Returns domains and mutates entity domain assignments.
   */
  synthesize(files: FileDNA[], entities: DNAObject[]): BusinessDomain[] {
    this.logger.info('Inferring business domains from file structure...');

    const domainClusters = this.clusterByTopLevelDirectory(files);
    const domains: BusinessDomain[] = [];
    const entityIndex = new Map(entities.map((e) => [e.path, e]));

    for (const [dirName, filePaths] of domainClusters) {
      // Skip non-domain directories
      if (this.isInfrastructureDirectory(dirName)) continue;
      if (filePaths.length < 2) continue; // Need at least 2 files to form a domain

      const domainId = `domain:${dirName}`;
      const domainEntities = filePaths
        .map((fp) => entityIndex.get(fp))
        .filter((e): e is DNAObject => e !== undefined);

      const languages = new Set<string>();
      for (const file of files.filter((f) => filePaths.includes(f.path))) {
        if (file.language) languages.add(file.language);
      }

      const domain: BusinessDomain = {
        id: domainId,
        name: this.humanizeDirName(dirName),
        inferenceSource: 'folder-structure',
        confidence: 0.6,
        rootPaths: [dirName],
        entityIds: domainEntities.map((e) => e.id),
        fileCount: filePaths.length,
        linesOfCode: 0, // Would need LOC data from files
        primaryLanguages: Array.from(languages),
        dependsOn: [],
        dependedOnBy: [],
        detectedAt: Date.now(),
      };

      domains.push(domain);

      // Enrich entities with domain membership
      for (const entity of domainEntities) {
        (entity as { businessDomain: string | null }).businessDomain = domain.name;
        (entity as { belongsToDomain: string | null }).belongsToDomain = domainId;
      }
    }

    this.logger.info(`Inferred ${domains.length} business domains`);
    this.computeDomainDependencies(domains, entities);

    return domains;
  }

  private clusterByTopLevelDirectory(files: FileDNA[]): Map<string, string[]> {
    const clusters = new Map<string, string[]>();
    for (const file of files) {
      const parts = file.path.replace(/\\/g, '/').split('/');
      // Use the first meaningful directory segment
      const topDir = parts.length > 1 ? (parts[0] ?? '_root') : '_root';
      const existing = clusters.get(topDir) ?? [];
      existing.push(file.path);
      clusters.set(topDir, existing);
    }
    return clusters;
  }

  private isInfrastructureDirectory(dirName: string): boolean {
    const infraDirs = new Set([
      'node_modules', 'dist', 'build', '.git', '.github', '.vscode',
      'coverage', '__tests__', 'test', 'tests', 'scripts', 'config',
      'configs', '.turbo', '.cache', '_root',
    ]);
    return infraDirs.has(dirName.toLowerCase());
  }

  private humanizeDirName(dirName: string): string {
    return dirName
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private computeDomainDependencies(domains: BusinessDomain[], entities: DNAObject[]): void {
    const entityDomainMap = new Map<string, string>();
    for (const entity of entities) {
      if (entity.belongsToDomain) {
        entityDomainMap.set(entity.id, entity.belongsToDomain);
      }
    }

    for (const domain of domains) {
      const depDomains = new Set<string>();
      const dependentDomains = new Set<string>();

      for (const entityId of domain.entityIds) {
        const entity = entities.find((e) => e.id === entityId);
        if (!entity) continue;

        for (const depId of entity.dependsOn) {
          const depDomain = entityDomainMap.get(depId);
          if (depDomain && depDomain !== domain.id) {
            depDomains.add(depDomain);
          }
        }

        for (const depId of entity.dependedOnBy) {
          const depDomain = entityDomainMap.get(depId);
          if (depDomain && depDomain !== domain.id) {
            dependentDomains.add(depDomain);
          }
        }
      }

      domain.dependsOn = Array.from(depDomains);
      domain.dependedOnBy = Array.from(dependentDomains);
    }
  }
}
