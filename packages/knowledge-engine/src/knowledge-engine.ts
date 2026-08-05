/**
 * @module KnowledgeEngine
 * Main orchestrator for generating deterministic structured knowledge.
 */
import type {
  ArchitectureDNA,
  FileDNA,
  IncrementalKnowledgeRequest,
  IKnowledgeEngine,
  KnowledgeResult,
  RepositoryDNA,
  RepositoryGraph,
} from '@project-dna/dna-core';
import { Err, Ok, type Logger, type Result } from '@project-dna/shared';
import { ConventionGenerator } from './generators/convention-generator.js';
import { knowledgeNode } from './generators/generator-utils.js';
import { PatternGenerator } from './generators/pattern-generator.js';
import { RiskGenerator } from './generators/risk-generator.js';

export class KnowledgeEngine implements IKnowledgeEngine {
  private readonly conventionGenerator = new ConventionGenerator();
  private readonly patternGenerator = new PatternGenerator();
  private readonly riskGenerator = new RiskGenerator();

  constructor(private readonly logger: Logger) {}

  public async generateKnowledge(
    repository: RepositoryDNA,
    files: FileDNA[],
    graph: RepositoryGraph,
    architecture: ArchitectureDNA,
    signal?: AbortSignal,
  ): Promise<Result<KnowledgeResult>> {
    try {
      if (signal?.aborted) return Err(new Error('Knowledge generation cancelled'));
      const generatedAt = Date.now();
      const conventionNodes = this.conventionGenerator.generate(files, repository, generatedAt);
      if (signal?.aborted) return Err(new Error('Knowledge generation cancelled'));
      const patternNodes = this.patternGenerator.generate(files, graph, generatedAt);
      if (signal?.aborted) return Err(new Error('Knowledge generation cancelled'));
      const risks = this.riskGenerator.generate(files, graph, generatedAt);
      if (signal?.aborted) return Err(new Error('Knowledge generation cancelled'));

      const nodes = [
        ...conventionNodes,
        ...patternNodes,
        knowledgeNode({
          type: 'metric',
          name: `Architecture: ${architecture.pattern}`,
          metadata: {
            pattern: architecture.pattern,
            confidence: architecture.confidence,
            layerCount: architecture.layers.length,
            evidenceCount: architecture.evidence.length,
          },
          tags: ['architecture', architecture.pattern],
          sourceRef: repository.rootPath,
          createdAt: generatedAt,
        }),
      ];

      this.logger.info(`Generated ${nodes.length} knowledge nodes and ${risks.length} risks`);
      return Ok({ nodes, risks });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Knowledge generation failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }

  public generateKnowledgeIncremental(
    request: IncrementalKnowledgeRequest,
    signal?: AbortSignal,
  ): Promise<Result<KnowledgeResult>> {
    return this.generateKnowledge(
      request.repository,
      request.files,
      request.graph,
      request.architecture,
      signal,
    );
  }
}
