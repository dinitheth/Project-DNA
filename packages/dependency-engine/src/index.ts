/**
 * @module @project-dna/dependency-engine
 * @description Single responsibility: build and analyze dependency graphs.
 */

export * from './dependency-engine.js';
export * from './analyzers/circular-dependency-analyzer.js';
export * from './analyzers/module-boundary-analyzer.js';
export * from './graph/graph-builder.js';
