import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});

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

function astEngine(): IAstEngine {
  const parseFile = async (input: FileInput): Promise<Result<ParseResult>> => {
    if (input.relativePath === 'invalid.ts') return Err(new Error('parse failed'));
    return Ok({
      fileDna: FileDNASchema.parse({
        id: input.relativePath,
        path: input.relativePath,
        language: input.language,
        hash: input.relativePath,
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

async function fixtureFile(root: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
