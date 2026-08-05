import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArchitectureDNASchema,
  DNAOrchestrator,
  FileDNASchema,
  RepositoryDNASchema,
  RepositoryGraph,
  type FileInput,
  type IArchitectureEngine,
  type IAstEngine,
  type IDependencyEngine,
  type IKnowledgeEngine,
  type IRepositoryScanner,
  type ParseResult,
  type RepositoryScanResult,
  type ScannedFile,
} from '../index.js';
import {
  Err,
  EventBus,
  Ok,
  createSilentLogger,
  isErr,
  type DNAEventMap,
  type Result,
} from '@project-dna/shared';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DNAOrchestrator coverage', () => {
  it('counts unsupported files as skipped and read or parse failures as failed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-coverage-'));
    roots.push(root);
    const validPath = await fixtureFile(root, 'valid.ts', 'export const valid = true;');
    const invalidPath = await fixtureFile(root, 'invalid.ts', 'invalid');
    const missingPath = path.join(root, 'missing.ts');
    const unsupportedPath = path.join(root, 'unsupported.rb');
    const scannedFiles: ScannedFile[] = [
      scannedFile(validPath, 'valid.ts', 'typescript'),
      scannedFile(invalidPath, 'invalid.ts', 'typescript'),
      scannedFile(missingPath, 'missing.ts', 'typescript'),
      scannedFile(unsupportedPath, 'unsupported.rb', 'ruby'),
    ];

    const orchestrator = new DNAOrchestrator({
      scanner: scanner(root, scannedFiles),
      astEngine: astEngine(),
      dependencyEngine: dependencyEngine(),
      architectureEngine: architectureEngine(),
      knowledgeEngine: knowledgeEngine(),
      eventBus: new EventBus<DNAEventMap>(),
      logger: createSilentLogger(),
    });

    const result = await orchestrator.analyzeRepository(root);
    if (isErr(result)) throw result.error;

    expect(result.value.coverage).toEqual({ scanned: 4, parsed: 1, skipped: 1, failed: 2 });
    expect(
      (result.value.coverage?.parsed ?? 0) +
        (result.value.coverage?.skipped ?? 0) +
        (result.value.coverage?.failed ?? 0),
    ).toBe(result.value.coverage?.scanned);
  });

  it('reuses unchanged AST results by content hash and reparses only changed content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-reuse-'));
    roots.push(root);
    const sourcePath = await fixtureFile(root, 'source.ts', 'export const value = 1;');
    const emptyPath = await fixtureFile(root, 'empty.ts', '');
    const fullScan = await scanResult(root, [
      scannedFile(sourcePath, 'source.ts', 'typescript'),
      scannedFile(emptyPath, 'empty.ts', 'typescript'),
    ]);
    const scans = [fullScan];
    const scanner = queuedScanner(scans);
    const parsedPaths: string[] = [];
    const orchestrator = orchestratorFor(scanner, astEngine(parsedPaths));

    const initial = await orchestrator.analyzeRepository(root);
    if (isErr(initial)) throw initial.error;
    expect(parsedPaths).toEqual(['source.ts', 'empty.ts']);
    expect(initial.value.files.map((file) => file.path)).toEqual(['empty.ts', 'source.ts']);

    scans.push(await scanResult(root, fullScan.files, 1));
    const touched = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: initial.value,
      changedPaths: [sourcePath],
    });
    if (isErr(touched)) throw touched.error;
    expect(parsedPaths).toEqual(['source.ts', 'empty.ts']);

    await writeFile(sourcePath, 'export const value = 2;', 'utf8');
    scans.push(await scanResult(root, fullScan.files, 2));
    const changed = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: touched.value,
      changedPaths: [sourcePath],
    });
    if (isErr(changed)) throw changed.error;
    expect(parsedPaths).toEqual(['source.ts', 'empty.ts', 'source.ts']);
    expect(changed.value.coverage).toEqual({ scanned: 2, parsed: 2, skipped: 0, failed: 0 });
  });

  it('removes stale AST data after a parse failure and recovers on the next change', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-failure-'));
    roots.push(root);
    const sourcePath = await fixtureFile(root, 'source.ts', 'export const value = 1;');
    const initialScan = await scanResult(root, [
      scannedFile(sourcePath, 'source.ts', 'typescript'),
    ]);
    const scans = [initialScan];
    const orchestrator = orchestratorFor(queuedScanner(scans), astEngine([], 'INVALID'));

    const initial = await orchestrator.analyzeRepository(root);
    if (isErr(initial)) throw initial.error;
    await writeFile(sourcePath, 'INVALID', 'utf8');
    scans.push(await scanResult(root, initialScan.files, 1));
    const failed = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: initial.value,
      changedPaths: [sourcePath],
    });
    if (isErr(failed)) throw failed.error;
    expect(failed.value.files).toEqual([]);
    expect(failed.value.failedPaths).toEqual(['source.ts']);
    expect(failed.value.coverage).toEqual({ scanned: 1, parsed: 0, skipped: 0, failed: 1 });

    await writeFile(sourcePath, 'export const value = 2;', 'utf8');
    scans.push(await scanResult(root, initialScan.files, 2));
    const recovered = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: failed.value,
      changedPaths: [sourcePath],
    });
    if (isErr(recovered)) throw recovered.error;
    expect(recovered.value.files.map((file) => file.path)).toEqual(['source.ts']);
    expect(recovered.value.failedPaths).toEqual([]);
  });

  it('calculates a deterministic dependency-connected dirty closure including deletions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-dirty-'));
    roots.push(root);
    const paths = await Promise.all(
      ['a.ts', 'b.ts', 'c.ts'].map((relativePath) =>
        fixtureFile(root, relativePath, `export const ${relativePath[0]} = true;`),
      ),
    );
    const initialScan = await scanResult(
      root,
      paths.map((filePath) => scannedFile(filePath, path.basename(filePath), 'typescript')),
    );
    const remainingFiles = initialScan.files.filter((file) => file.relativePath !== 'c.ts');
    const deletionScan = await scanResult(root, remainingFiles, 1);
    const dependency = dependencyEngineWithChain();
    const orchestrator = orchestratorFor(
      queuedScanner([initialScan, deletionScan]),
      astEngine(),
      dependency,
    );

    const initial = await orchestrator.analyzeRepository(root);
    if (isErr(initial)) throw initial.error;
    const updated = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: initial.value,
      changedPaths: [paths[2]!],
    });
    if (isErr(updated)) throw updated.error;

    expect(updated.value.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(updated.value.dirtyPaths).toEqual(['a.ts', 'b.ts']);
  });

  it('falls back to a full scan when the previous result has no scanner manifest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'project-dna-fallback-'));
    roots.push(root);
    const sourcePath = await fixtureFile(root, 'source.ts', 'export const value = 1;');
    const result = await scanResult(root, [scannedFile(sourcePath, 'source.ts', 'typescript')]);
    const fullScan = vi.fn(async () => Ok(result));
    const incrementalScan = vi.fn(async () => Ok(result));
    const orchestrator = orchestratorFor(
      { scan: fullScan, scanIncremental: incrementalScan },
      astEngine(),
    );
    const initial = await orchestrator.analyzeRepository(root);
    if (isErr(initial)) throw initial.error;

    const withoutManifest = { ...initial.value, scan: undefined };
    const refreshed = await orchestrator.analyzeRepositoryIncremental({
      rootPath: root,
      previous: withoutManifest,
      changedPaths: [sourcePath],
    });
    if (isErr(refreshed)) throw refreshed.error;

    expect(fullScan).toHaveBeenCalledTimes(2);
    expect(incrementalScan).not.toHaveBeenCalled();
  });
});

function orchestratorFor(
  repositoryScanner: IRepositoryScanner,
  repositoryAstEngine: IAstEngine,
  repositoryDependencyEngine: IDependencyEngine = dependencyEngine(),
): DNAOrchestrator {
  return new DNAOrchestrator({
    scanner: repositoryScanner,
    astEngine: repositoryAstEngine,
    dependencyEngine: repositoryDependencyEngine,
    architectureEngine: architectureEngine(),
    knowledgeEngine: knowledgeEngine(),
    eventBus: new EventBus<DNAEventMap>(),
    logger: createSilentLogger(),
  });
}

function scanner(rootPath: string, files: ScannedFile[]): IRepositoryScanner {
  return {
    async scan() {
      return Ok({
        repository: RepositoryDNASchema.parse({
          id: 'repository',
          name: 'fixture',
          rootPath,
          languages: [],
          frameworks: [],
          metadata: {
            hasReadme: false,
            hasLicense: false,
            hasGitIgnore: false,
            hasTsConfig: false,
            hasPackageJson: false,
          },
          totalFiles: files.length,
          totalLinesOfCode: 1,
          createdAt: 1,
          updatedAt: 1,
        }),
        files,
      });
    },
  };
}

function astEngine(parsedPaths: string[] = [], invalidContent?: string): IAstEngine {
  const parseFile = async (input: FileInput): Promise<Result<ParseResult>> => {
    parsedPaths.push(input.relativePath ?? input.path);
    if (input.relativePath === 'invalid.ts' || input.content === invalidContent) {
      return Err(new Error('parse failed'));
    }
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    return Ok({
      fileDna: FileDNASchema.parse({
        id: input.relativePath,
        path: input.relativePath,
        language: input.language,
        hash: contentHash,
        size: input.content.length,
        linesOfCode: 1,
        classIds: [],
        functionIds: [],
        imports: [],
        exports: [],
        comments: [],
        complexity: 1,
      }),
      classes: [],
      functions: [],
    });
  };

  return {
    parseFile,
    async *parseFiles(inputs) {
      for (const input of inputs) yield await parseFile(input);
    },
    getSupportedLanguages() {
      return ['typescript'];
    },
  };
}

function dependencyEngineWithChain(): IDependencyEngine {
  const build = (files: readonly { path: string }[]) => {
    const graph = new RepositoryGraph();
    for (const file of files) graph.addFileNode(file.path, { label: file.path, path: file.path });
    if (graph.hasNode('a.ts') && graph.hasNode('b.ts')) {
      graph.addDependency('a.ts', 'b.ts', dependencyAttributes());
    }
    if (graph.hasNode('b.ts') && graph.hasNode('c.ts')) {
      graph.addDependency('b.ts', 'c.ts', dependencyAttributes());
    }
    return graph;
  };
  return {
    async buildDependencyGraph(files) {
      return Ok(build(files));
    },
    async buildDependencyGraphIncremental(request) {
      return Ok(build(request.files));
    },
    detectCircularDependencies() {
      return [];
    },
  };
}

function dependencyAttributes() {
  return {
    type: 'import' as const,
    isTypeOnly: false,
    specifierCount: 1,
    isExternal: false,
  };
}

function dependencyEngine(): IDependencyEngine {
  return {
    async buildDependencyGraph(files) {
      const graph = new RepositoryGraph();
      for (const file of files) {
        graph.addFileNode(file.path, { label: file.path, path: file.path });
      }
      return Ok(graph);
    },
    detectCircularDependencies() {
      return [];
    },
  };
}

function architectureEngine(): IArchitectureEngine {
  return {
    async inferArchitecture() {
      return Ok(
        ArchitectureDNASchema.parse({
          id: 'architecture',
          pattern: 'unknown',
          confidence: 0,
          detectedPatterns: [],
          layers: [],
          evidence: [],
          detectedAt: 1,
        }),
      );
    },
  };
}

function knowledgeEngine(): IKnowledgeEngine {
  return {
    async generateKnowledge() {
      return Ok({ nodes: [], risks: [] });
    },
  };
}

function scannedFile(filePath: string, relativePath: string, language: string): ScannedFile {
  return { path: filePath, relativePath, language, size: 1 };
}

async function scanResult(
  rootPath: string,
  files: readonly ScannedFile[],
  modifiedOffset = 0,
): Promise<RepositoryScanResult> {
  const manifest = await Promise.all(
    files.map(async (file) => {
      const fileStats = await stat(file.path);
      return {
        path: file.path,
        relativePath: file.relativePath,
        size: fileStats.size,
        modifiedAtMs: fileStats.mtimeMs + modifiedOffset,
        language: file.language,
        analyzable: true,
        linesOfCode: 1,
      };
    }),
  );
  return {
    repository: RepositoryDNASchema.parse({
      id: 'repository',
      name: 'fixture',
      rootPath,
      languages: [],
      frameworks: [],
      metadata: {
        hasReadme: false,
        hasLicense: false,
        hasGitIgnore: false,
        hasTsConfig: false,
        hasPackageJson: false,
      },
      totalFiles: files.length,
      totalLinesOfCode: files.length,
      createdAt: 1,
      updatedAt: 1 + modifiedOffset,
    }),
    files: [...files],
    manifest,
  };
}

function queuedScanner(results: readonly RepositoryScanResult[]): IRepositoryScanner {
  let index = 0;
  const next = () => results[Math.min(index++, results.length - 1)]!;
  return {
    async scan() {
      return Ok(next());
    },
    async scanIncremental() {
      return Ok(next());
    },
  };
}

async function fixtureFile(root: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
