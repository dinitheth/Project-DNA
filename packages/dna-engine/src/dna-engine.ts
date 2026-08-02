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
import type { IDNAEngine, SynthesisInput, SynthesisOutput } from '@project-dna/dna-core';
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

  async synthesize(input: SynthesisInput, _signal?: AbortSignal): Promise<Result<SynthesisOutput>> {
    try {
      this.logger.info('Starting DNA synthesis...');
      const startTime = Date.now();

      // Step 1: Synthesize raw files into enriched entities
      const entities = this.entitySynthesizer.synthesize(
        input.files,
        input.dependencyGraph,
        input.architecture,
        input.knowledgeNodes,
        input.risks,
      );

      // Step 2: Infer repository identity
      const profile = this.identitySynthesizer.synthesize(
        input.repository,
        input.files,
        input.architecture,
      );

      // Step 3: Infer business domains (mutates entity domain assignments)
      const domains = this.domainSynthesizer.synthesize(input.files, entities);

      // Step 4: Detect capabilities
      const capabilities = this.capabilitySynthesizer.synthesize(input.repository, input.files);

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
}
