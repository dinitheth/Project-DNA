import { Container } from '@project-dna/shared';
import { DNAOrchestrator } from '@project-dna/dna-core';

export function createContainer(): Container {
  const container = new Container();
  
  // Register orchestrator and engines here
  container.register(Symbol.for('DNAOrchestrator'), () => new DNAOrchestrator(null as any));
  
  return container;
}
