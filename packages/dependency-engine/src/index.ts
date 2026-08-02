/**
 * @module @project-dna/dependency-engine
 * @description Single responsibility: build and analyze dependency graphs.
 */

export * from './dependency-engine';
export * from './analyzers/circular-dependency-analyzer';
export * from './analyzers/module-boundary-analyzer';
export * from './graph/graph-builder';
