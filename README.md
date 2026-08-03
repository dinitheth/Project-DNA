# Project DNA

**The Living Intelligence Layer for Software**

Project DNA is a software intelligence engine that understands what a repository IS, not just what it contains. It transforms raw source code into structured, queryable, evolving knowledge through deterministic analysis -- no AI, no cloud dependencies, fully offline.

---

## Table of Contents

- [Vision](#vision)
- [What Project DNA Is Not](#what-project-dna-is-not)
- [Architecture Overview](#architecture-overview)
- [Package Map](#package-map)
- [The Pipeline](#the-pipeline)
- [Domain Model](#domain-model)
- [The Public API](#the-public-api)
- [Design Principles](#design-principles)
- [Project Structure](#project-structure)
- [Development](#development)
- [Technology Stack](#technology-stack)
- [Status](#status)

---

## Vision

Every software repository has a DNA -- a unique combination of architecture, complexity, health, risk, business domains, capabilities, and evolutionary history. Today, this DNA is invisible. It exists only in the heads of senior engineers.

Project DNA makes it visible, structured, and queryable.

The system analyzes a repository and produces a `ProjectDNA` object: a comprehensive, versioned, diffable representation of what the software IS. Not a summary. Not documentation. Not a diagram. A living, evolving model of the software's identity.

---

## What Project DNA Is Not

- **Not an AI coding assistant.** It does not write code. It does not suggest completions.
- **Not a documentation generator.** It does not produce markdown files or API docs.
- **Not a code search tool.** It does not index text or find string matches.
- **Not a static architecture viewer.** It does not just draw boxes and arrows.
- **Not a git visualization tool.** It does not render commit graphs.
- **Not a repository scanner.** Scanning is one small input to a much larger system.

Project DNA is a new category: a software intelligence engine that understands the holistic identity of a codebase through deterministic analysis.

---

## Architecture Overview

The system is built as a layered monorepo with strict dependency inversion. Each layer only depends downward, never upward. All engine implementations depend on interfaces defined in `dna-core`, never on each other.

```
Layer 1: Domain Models + Interfaces (dna-core)
    Defines WHAT exists. Zero logic. Zero side effects.
    Every other package depends on this. This depends on nothing.

Layer 2: Analysis Engines
    Extract raw structural data from source code.
    Scanner, AST Parser, Dependency Resolver, Architecture Inference, Knowledge Generator.

Layer 3: Synthesis Engine (dna-engine)
    Fuses all raw analysis outputs into unified software identity.
    Produces DNAObjects, DNAGraph, RepositoryProfile, BusinessDomains, Capabilities.

Layer 4: Intelligence Engine (software-intelligence-engine)
    Computes actionable intelligence from synthesized DNA.
    Health scoring, complexity profiling, risk assessment, criticality analysis, narrative generation.

Layer 5: Evolution Engine (evolution-engine)
    Tracks changes over time.
    Snapshots, diffs, trend analysis, regression detection.

Layer 6: Storage (storage)
    Hybrid persistence: SQLite for structured data, in-memory Graphology for graph operations.

Layer 7: Presentation (vscode-extension, ui-components)
    VS Code extension and webview components that consume the public API.

Infrastructure: Shared Kernel (shared)
    Result type, EventBus, DI container, logging, Zod schemas.
```

---

## Package Map

| Package                                     | Layer          | Responsibility                                                                                          |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `@project-dna/shared`                       | Infrastructure | Result type, EventBus, DI container, logging, common types                                              |
| `@project-dna/dna-core`                     | 1              | Domain models (22 models), engine interfaces (9 interfaces), pipeline orchestrator                      |
| `@project-dna/repository-scanner`           | 2              | File system scanning, language detection, framework detection                                           |
| `@project-dna/ast-engine`                   | 2              | TypeScript/JavaScript extraction plus Tree-sitter WASM parsing for Python, Go, Java, Rust, and C#      |
| `@project-dna/dependency-engine`            | 2              | Dependency graph construction, circular dependency detection                                            |
| `@project-dna/architecture-engine`          | 2              | Deterministic architecture inference via heuristics (MVC, Clean, Hexagonal, DDD, Layered, Microservice) |
| `@project-dna/knowledge-engine`             | 2              | Structured knowledge generation, code smell detection                                                   |
| `@project-dna/dna-engine`                   | 3              | Entity synthesis, identity inference, domain clustering, capability detection, semantic graph           |
| `@project-dna/software-intelligence-engine` | 4              | Health scoring, complexity analysis, risk aggregation, criticality ranking, narrative story             |
| `@project-dna/evolution-engine`             | 5              | Snapshot versioning, diffing, trend analysis                                                            |
| `@project-dna/storage`                      | 6              | Hybrid SQLite + Graphology persistence                                                                  |
| `@project-dna/ui-components`                | 7              | Webview UI components                                                                                   |
| `vscode-extension`                          | 7              | VS Code extension host                                                                                  |

---

## The Pipeline

Project DNA processes repositories through a 10-stage pipeline:

```
Stage 1: SCAN
    Input:  Repository root path
    Output: RepositoryDNA (languages, frameworks, config files, file manifest)
    Engine: IRepositoryScanner

Stage 2: PARSE
    Input:  File paths + contents
    Output: FileDNA[] (imports, exports, classes, functions per file)
    Engine: IAstEngine

Stage 3: RESOLVE DEPENDENCIES
    Input:  FileDNA[]
    Output: RepositoryGraph (structural dependency graph)
    Engine: IDependencyEngine

Stage 4: INFER ARCHITECTURE
    Input:  RepositoryGraph + RepositoryDNA
    Output: ArchitectureDNA (detected pattern, layers, confidence, evidence)
    Engine: IArchitectureEngine

Stage 5: GENERATE KNOWLEDGE
    Input:  RepositoryDNA + FileDNA[] + RepositoryGraph + ArchitectureDNA
    Output: KnowledgeNode[] + RiskNode[]
    Engine: IKnowledgeEngine

Stage 6: SYNTHESIZE DNA
    Input:  All outputs from Stages 1-5
    Output: DNAObject[] + DNAGraph + RepositoryProfile + BusinessDomain[] + Capability[]
    Engine: IDNAEngine

Stage 7: COMPUTE INTELLIGENCE
    Input:  Synthesized DNA from Stage 6
    Output: RepositoryHealth + ComplexityProfile + RiskAssessment + CriticalComponent[] + RepositoryStory
    Engine: ISoftwareIntelligenceEngine

Stage 8: ASSEMBLE ProjectDNA
    The aggregate root is assembled from all pipeline outputs.
    Lightweight: contains summaries and counts, not full collections.
    Full data loaded on demand via IProjectDNAQuery.

Stage 9: SNAPSHOT
    Input:  ProjectDNA
    Output: EvolutionSnapshot (versioned, content-hashed, with extracted metrics)
    Engine: IEvolutionEngine

Stage 10: DIFF (if previous snapshot exists)
    Input:  Two EvolutionSnapshots
    Output: DNADiff (entity changes, health deltas, risk changes, topology shifts)
    Engine: IEvolutionEngine
```

Every stage emits typed events through the EventBus. Every stage supports cancellation via AbortSignal. Every stage returns `Result<T>` for explicit error handling.

---

## Domain Model

### Core Analysis Models (Layer 2 outputs)

| Model             | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `RepositoryDNA`   | Raw repository metadata: languages, frameworks, config files         |
| `FileDNA`         | Per-file structure: imports, exports, symbols                        |
| `ClassDNA`        | Class metadata: methods, properties, inheritance                     |
| `FunctionDNA`     | Function metadata: parameters, return type, complexity               |
| `DependencyDNA`   | Import/export dependency information                                 |
| `ModuleDNA`       | Logical module groupings                                             |
| `ArchitectureDNA` | Detected architecture pattern, layers, confidence scores             |
| `KnowledgeNode`   | Structured knowledge observations                                    |
| `RiskNode`        | Detected code risks and smells                                       |
| `RepositoryGraph` | Structural dependency graph (Graphology wrapper, sealed abstraction) |

### Synthesis Models (Layer 3 outputs)

| Model               | Purpose                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `DNAObject`         | Universal enriched entity with purpose, role, criticality, health, and relationships                |
| `DNAGraph`          | Semantic knowledge graph (domains, capabilities, layers, concepts -- distinct from RepositoryGraph) |
| `RepositoryProfile` | Software identity: project type, maturity, technology stack, size classification                    |
| `BusinessDomain`    | Inferred business domain cluster (e.g., "authentication", "billing")                                |
| `Capability`        | Detected functional ability (e.g., "REST API serving", "SQL database access")                       |

### Intelligence Models (Layer 4 outputs)

| Model               | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `RepositoryHealth`  | Composite health score across 5 dimensions (0-100)               |
| `ComplexityProfile` | Complexity distribution, coupling metrics, instability indices   |
| `RiskAssessment`    | Aggregated risk picture with severity distribution and top risks |
| `CriticalComponent` | High blast-radius entities identified via multi-factor scoring   |
| `RepositoryStory`   | Deterministic narrative assembled from structured data           |

### Evolution Models (Layer 5 outputs)

| Model               | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `EvolutionSnapshot` | Point-in-time capture with extracted metrics for fast trending       |
| `DNADiff`           | What changed between two versions: entities, health, risks, topology |

### The Aggregate Root

| Model        | Purpose                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ProjectDNA` | The single entry point for querying. Lightweight: holds identity, summaries, and counts. Full collections loaded on demand. |

---

## The Public API

The public API follows the Interface Segregation Principle. It is composed from four focused sub-interfaces:

```
IProjectDNAService
    IProjectDNAAnalyzer   -- analyze(), refresh(), getCurrent(), dispose()
    IProjectDNAQuery      -- getArchitecture(), getHealth(), getEntities(), getDNAGraph(), ...
    IProjectDNAEvolution  -- getHistory(), getDiff(), getLatestSnapshot()
    IProjectDNAEvents     -- onProgress(), onReady()
```

Consumers depend on the narrowest sub-interface they need. Commands use `IProjectDNAAnalyzer`. UI views use `IProjectDNAQuery`. Progress bars use `IProjectDNAEvents`. Nothing bypasses this API.

---

## Design Principles

### Everything works offline

No cloud services. No API keys. No telemetry. The entire system runs on the local machine with zero network dependencies.

### AI is never the source of truth

All analysis is deterministic. The system uses heuristics, not machine learning. When AI is eventually integrated, it will ENHANCE the intelligence layer, never REPLACE it. Every fact in ProjectDNA maps to a measurable observation.

### Dependency inversion everywhere

The orchestrator depends on interfaces, never implementations. The composition root (VS Code extension's `container.ts`) wires concrete implementations. Engines can be swapped, mocked, or upgraded independently.

### Result type for all fallible operations

No thrown exceptions for expected failures. Every async operation returns `Result<T, E>`. The `isErr()` guard provides type-safe error handling at every pipeline stage.

### Event-driven coordination

The pipeline uses a typed EventBus for all cross-engine communication. Listeners are error-isolated -- a failing UI listener cannot crash the analysis pipeline. Events are the only mechanism for progress reporting.

### Lightweight aggregate root

The `ProjectDNA` aggregate contains only identity, summaries, and counts. Heavyweight collections (entities, knowledge nodes, graphs) are not embedded. They are loaded on demand via `IProjectDNAQuery` methods. This prevents memory issues on repositories with 50,000+ files.

### Zod schemas at every boundary

All domain models use Zod schemas for runtime validation. Types are inferred from schemas, ensuring the type system and runtime validation stay in sync.

### Cancellation support

Every async engine method accepts an optional `AbortSignal`. The orchestrator checks for cancellation at every stage boundary. This enables the VS Code extension to cancel long-running analyses when the user switches workspaces.

---

## Project Structure

```
Project DNA/
    packages/
        shared/                          Infrastructure kernel
            src/
                di/                      Dependency injection container + tokens
                events/                  EventBus + DNA event definitions
                result/                  Result<T, E> type + Ok/Err constructors
                logging/                 Logger interface
                types/                   Common type definitions

        dna-core/                        Domain models + interfaces (Layer 1)
            src/
                models/                  22 domain models (Zod schemas + types)
                interfaces/              9 engine interfaces + public API
                orchestrator/            Pipeline stages + analysis orchestrator

        repository-scanner/              File system scanning (Layer 2)
        ast-engine/                      Source code parsing (Layer 2)
        dependency-engine/               Dependency graph construction (Layer 2)
        architecture-engine/             Architecture pattern inference (Layer 2)
        knowledge-engine/                Knowledge + risk generation (Layer 2)

        dna-engine/                      Synthesis layer (Layer 3)
            src/
                synthesizers/            Entity, identity, domain, capability synthesizers
                graph/                   DNAGraph builder

        software-intelligence-engine/    Reasoning layer (Layer 4)
            src/
                analyzers/               Health, complexity, risk, criticality analyzers
                narrative/               Deterministic story generator

        evolution-engine/                Versioning layer (Layer 5)
            src/
                snapshot/                Snapshot creation + compression
                diff/                    DNA diffing

        storage/                         Hybrid SQLite + Graphology (Layer 6)
        ui-components/                   Webview UI components (Layer 7)

    apps/
        vscode-extension/                VS Code extension host (Layer 7)

    turbo.json                           Turborepo pipeline configuration
    pnpm-workspace.yaml                  PNPM workspace definition
    tsconfig.base.json                   Shared TypeScript configuration
```

---

## Development

### Prerequisites

- Node.js >= 20
- PNPM 9.x

### Setup

```bash
pnpm install
```

### Commands

```bash
# Install workspace dependencies
pnpm install

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Build packages and the VS Code extension/webview
pnpm build

# Clean all build artifacts
pnpm clean
```

### Adding a new domain model

1. Create the Zod schema in `packages/dna-core/src/models/`
2. Export the schema and type from `packages/dna-core/src/models/index.ts`
3. If needed, add a DI token in `packages/shared/src/di/tokens.ts`
4. Run `pnpm turbo run typecheck` to verify

### Adding a new engine

1. Define the interface in `packages/dna-core/src/interfaces/`
2. Export it from `packages/dna-core/src/interfaces/index.ts`
3. Add a DI token in `packages/shared/src/di/tokens.ts`
4. Create the implementation package under `packages/`
5. Wire it in the composition root (`vscode-extension/src/container.ts`)

---

## Technology Stack

| Component  | Technology                | Rationale                                                                |
| ---------- | ------------------------- | ------------------------------------------------------------------------ |
| Language   | TypeScript 5.7+           | Type safety, ecosystem, VS Code integration                              |
| Monorepo   | Turborepo + PNPM          | Fast builds, workspace dependencies, cache                               |
| Validation | Zod                       | Runtime schema validation with type inference                            |
| Graph      | Graphology                | In-memory directed graph with traversal algorithms                       |
| Storage    | better-sqlite3            | Embedded, zero-config, single-file persistence                           |
| Testing    | Vitest                    | Fast, TypeScript-native, watch mode                                      |
| Extension  | VS Code Extension API     | Target platform for the initial product                                  |
| Build      | TypeScript, esbuild, Vite | Type checking for packages plus extension and webview production bundles |

---

## Status

### Implemented

- 13 packages in the monorepo with a clean dependency graph
- Domain models and engine interfaces validated with Zod schemas
- Repository scanner with recursive traversal, `.gitignore` support, metadata detection, language/framework detection, source manifests, limits, and cancellation
- TypeScript/TSX/JavaScript/JSX AST extraction for imports, exports, re-exports, dynamic imports, comments, classes, methods, properties, decorators, functions, LOC, complexity, and deterministic hashes
- Tree-sitter WASM parser path with Python, Go, Java, Rust, and C# structural extraction for classes/structs/interfaces, methods, functions, fields, imports, exports, comments, LOC, and complexity
- Sealed `RepositoryGraph` with internal, aliased, workspace, dynamic, type-only, re-export, and external dependency resolution
- Linear-time circular dependency detection and module-boundary summaries
- Architecture inference for MVC, Clean, Hexagonal, DDD, Layered, and Microservice patterns, including confidence scores, evidence, deterministic ranking, inferred layers, stable IDs, and unknown fallback
- Knowledge generation with deterministic convention, pattern, repository-structure, export, dynamic-loading, dependency-hub, and architecture observations
- Risk detection for high complexity, large files, excessive imports, circular dependencies, orphan files, unstable modules, and oversized barrel exports
- DNA synthesis engine with entity, identity, domain, capability, and semantic graph builders
- Software intelligence engine with health, complexity, risk, criticality, and deterministic narrative analysis
- Evolution engine with snapshot creation and DNA diffing
- End-to-end `ProjectDNAService` orchestration across analysis, synthesis, intelligence, aggregate assembly, refresh, queries, and evolution snapshots
- SQLite persistence for versioned Project DNA aggregates, heavyweight collections, graphs, repository indexes, and evolution history
- Automatic VS Code workspace restoration with version continuity across extension restarts
- VS Code composition root wired to all concrete engines, with functional Analyze, Refresh, and Generate DNA commands
- Typed `Result<T>` error handling, cancellation support, dependency injection, and error-isolated EventBus coordination
- ESLint 9 flat configuration and production extension/webview build
- 60 automated tests passing across the implemented analysis and storage packages

### Next

- Add incremental file-watcher analysis
- Expand VS Code webview panels and UI component behavior

---

## License

Project DNA is open-source software licensed under the [MIT License](LICENSE).
