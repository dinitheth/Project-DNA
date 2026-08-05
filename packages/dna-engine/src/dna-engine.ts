/**
 * DNAEngine — The synthesis layer implementation.
 *
 * Implements IDNAEngine. Takes all raw analysis outputs and fuses them
 * into unified software identity: enriched entities, semantic graph,
 * repository profile, business domains, and capabilities.
 *
 * Analogy: The analysis engines are individual medical tests.
 * The DNA Engine is the doctor who reads all results and says
 * "here is what this patient IS."
 */

import { Ok, Err } from '@project-dna/shared';
import type { Logger, Result } from '@project-dna/shared';
import type {
  DNAObject,
  IDNAEngine,
  IncrementalSynthesisRequest,
  SynthesisInput,
  SynthesisOutput,
} from '@project-dna/dna-core';
import { EntitySynthesizer } from './synthesizers/entity-synthesizer.js';
import { IdentitySynthesizer } from './synthesizers/identity-synthesizer.js';
import { DomainSynthesizer } from './synthesizers/domain-synthesizer.js';
import { CapabilitySynthesizer } from './synthesizers/capability-synthesizer.js';
import { DNAGraphBuilder } from './graph/dna-graph-builder.js';

export class DNAEngine implements IDNAEngine {
  private readonly entitySynthesizer: EntitySynthesizer;
  private readonly identitySynthesizer: IdentitySynthesizer;
  private readonly domainSynthesizer: DomainSynthesizer;
  private readonly capabilitySynthesizer: CapabilitySynthesizer;
  private readonly graphBuilder: DNAGraphBuilder;

  constructor(private readonly logger: Logger) {
    this.entitySynthesizer = new EntitySynthesizer(logger);
    this.identitySynthesizer = new IdentitySynthesizer(logger);
    this.domainSynthesizer = new DomainSynthesizer(logger);
    this.capabilitySynthesizer = new CapabilitySynthesizer(logger);
    this.graphBuilder = new DNAGraphBuilder(logger);
  }

  async synthesize(input: SynthesisInput, signal?: AbortSignal): Promise<Result<SynthesisOutput>> {
    try {
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));
      this.logger.info('Starting DNA synthesis...');
      const startTime = Date.now();
      const orderedFiles = [...input.files].sort((left, right) =>
        left.path.localeCompare(right.path),
      );

      // Step 1: Synthesize raw files into enriched entities
      const entities = this.entitySynthesizer.synthesize(
        orderedFiles,
        input.dependencyGraph,
        input.architecture,
        input.knowledgeNodes,
        input.risks,
      );
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));

      // Step 2: Infer repository identity
      const profile = this.identitySynthesizer.synthesize(
        input.repository,
        orderedFiles,
        input.architecture,
      );
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));

      // Step 3: Infer business domains (mutates entity domain assignments)
      const domains = this.domainSynthesizer.synthesize(orderedFiles, entities);
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));

      // Step 4: Detect capabilities
      const capabilities = this.capabilitySynthesizer.synthesize(input.repository, orderedFiles);
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));

      // Step 5: Build semantic DNA graph
      const dnaGraph = this.graphBuilder.build(entities, domains, capabilities, input.architecture);

      const durationMs = Date.now() - startTime;
      this.logger.info(
        `DNA synthesis complete: ${entities.length} entities, ${domains.length} domains, ` +
          `${capabilities.length} capabilities, ${dnaGraph.nodeCount} graph nodes (${durationMs}ms)`,
      );

      return Ok({
        entities,
        dnaGraph,
        profile,
        domains,
        capabilities,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`DNA synthesis failed: ${err.message}`);
      return Err(err);
    }
  }

  async synthesizeIncremental(
    request: IncrementalSynthesisRequest,
    signal?: AbortSignal,
  ): Promise<Result<SynthesisOutput>> {
    try {
      if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));
      const dirtyIds = new Set(request.dirtyEntityIds);
      const previousEntities = new Map(
        request.previous.entities.map((entity) => [entity.id, entity] as const),
      );
      const orderedFiles = [...request.input.files].sort((left, right) =>
        left.path.localeCompare(right.path),
      );
      const entities: DNAObject[] = [];

      for (const file of orderedFiles) {
        if (signal?.aborted) return Err(new Error('DNA synthesis cancelled'));
        const entityId = `file:${file.path}`;
        const previous = previousEntities.get(entityId);
        if (previous && !dirtyIds.has(entityId)) {
          entities.push({
            ...previous,
            risks: [...previous.risks],
            dependsOn: [...previous.dependsOn],
            dependedOnBy: [...previous.dependedOnBy],
            knowledgeNodeIds: [...previous.knowledgeNodeIds],
          });
          continue;
        }
        const synthesized = this.entitySynthesizer.synthesize(
          [file],
          request.input.dependencyGraph,
          request.input.architecture,
          request.input.knowledgeNodes,
          request.input.risks,
        );
        const entity = synthesized[0];
        if (entity) entities.push(entity);
      }

      const profile = this.identitySynthesizer.synthesize(
        request.input.repository,
        orderedFiles,
        request.input.architecture,
      );
      for (const entity of entities) {
        entity.businessDomain = null;
        entity.belongsToDomain = null;
      }
      const domains = this.domainSynthesizer.synthesize(orderedFiles, entities);
      const capabilities = this.capabilitySynthesizer.synthesize(
        request.input.repository,
        orderedFiles,
      );
      const dnaGraph = this.graphBuilder.build(
        entities,
        domains,
        capabilities,
        request.input.architecture,
      );
      return Ok({ entities, dnaGraph, profile, domains, capabilities });
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Incremental DNA synthesis failed: ${resolvedError.message}`);
      return Err(resolvedError);
    }
  }
}
