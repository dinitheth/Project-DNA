import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Declarative size and shape of a generated repository benchmark fixture. */
export interface RepositoryBenchmarkFixtureOptions {
  readonly name: string;
  readonly analyzableFileCount: number;
  readonly unsupportedFileCount?: number;
  readonly statementsPerFile?: number;
  readonly moduleCount?: number;
}

/** Generated repository and its deterministic inventory. */
export interface RepositoryBenchmarkFixture {
  readonly rootPath: string;
  readonly sourcePaths: readonly string[];
  readonly unsupportedPaths: readonly string[];
  cleanup(): Promise<void>;
}

/** Named fixture profiles used by regression and scalability benchmark runs. */
export const RepositoryBenchmarkScenarios = {
  regression: {
    name: 'regression',
    analyzableFileCount: 4,
    unsupportedFileCount: 1,
    statementsPerFile: 1,
    moduleCount: 2,
  },
  small: {
    name: 'small',
    analyzableFileCount: 100,
    unsupportedFileCount: 10,
    statementsPerFile: 3,
    moduleCount: 8,
  },
  medium: {
    name: 'medium',
    analyzableFileCount: 1_000,
    unsupportedFileCount: 100,
    statementsPerFile: 4,
    moduleCount: 32,
  },
  large: {
    name: 'large',
    analyzableFileCount: 10_000,
    unsupportedFileCount: 1_000,
    statementsPerFile: 4,
    moduleCount: 128,
  },
  scale50: {
    name: 'scale50',
    analyzableFileCount: 50_000,
    unsupportedFileCount: 0,
    statementsPerFile: 4,
    moduleCount: 256,
  },
  scale75: {
    name: 'scale75',
    analyzableFileCount: 75_000,
    unsupportedFileCount: 0,
    statementsPerFile: 4,
    moduleCount: 384,
  },
  scale100: {
    name: 'scale100',
    analyzableFileCount: 100_000,
    unsupportedFileCount: 0,
    statementsPerFile: 4,
    moduleCount: 512,
  },
  reference: {
    name: 'reference',
    analyzableFileCount: 50_000,
    unsupportedFileCount: 50_000,
    statementsPerFile: 4,
    moduleCount: 256,
  },
  stress: {
    name: 'stress',
    analyzableFileCount: 100_000,
    unsupportedFileCount: 0,
    statementsPerFile: 4,
    moduleCount: 512,
  },
} as const satisfies Record<string, RepositoryBenchmarkFixtureOptions>;

/** Create a deterministic repository on the local temporary filesystem. */
export async function createRepositoryBenchmarkFixture(
  options: RepositoryBenchmarkFixtureOptions,
): Promise<RepositoryBenchmarkFixture> {
  validateOptions(options);
  const rootPath = await mkdtemp(path.join(tmpdir(), `project-dna-benchmark-${options.name}-`));
  const sourcePaths = createSourcePaths(options);
  const unsupportedPaths = Array.from(
    { length: options.unsupportedFileCount ?? 0 },
    (_, index) => `docs/note-${formatIndex(index)}.md`,
  );

  try {
    await Promise.all([
      writeFixtureFile(
        rootPath,
        'package.json',
        `${JSON.stringify({ name: `benchmark-${options.name}`, private: true }, null, 2)}\n`,
      ),
      writeFixtureFile(
        rootPath,
        'tsconfig.json',
        `${JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }, null, 2)}\n`,
      ),
    ]);

    await writeInBatches(sourcePaths, 64, async (relativePath, index) => {
      const previousPath = index > 0 ? sourcePaths[index - 1] : undefined;
      await writeFixtureFile(
        rootPath,
        relativePath,
        createSourceContent(relativePath, index, previousPath, options.statementsPerFile ?? 1),
      );
    });
    await writeInBatches(unsupportedPaths, 64, async (relativePath, index) => {
      await writeFixtureFile(rootPath, relativePath, `# Benchmark note ${index}\n`);
    });
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true });
    throw error;
  }

  return {
    rootPath,
    sourcePaths,
    unsupportedPaths,
    cleanup: () => rm(rootPath, { recursive: true, force: true }),
  };
}

function createSourcePaths(options: RepositoryBenchmarkFixtureOptions): string[] {
  const moduleCount = Math.min(options.moduleCount ?? 1, options.analyzableFileCount);
  return Array.from({ length: options.analyzableFileCount }, (_, index) => {
    const moduleIndex = index % moduleCount;
    return `src/module-${formatIndex(moduleIndex)}/file-${formatIndex(index)}.ts`;
  });
}

function createSourceContent(
  relativePath: string,
  index: number,
  previousPath: string | undefined,
  statementsPerFile: number,
): string {
  const importStatement = previousPath
    ? `import { value as previousValue } from '${relativeImport(relativePath, previousPath)}';\n`
    : '';
  const baseExpression = previousPath ? 'previousValue + 1' : '1';
  const statements = Array.from(
    { length: statementsPerFile },
    (_, statementIndex) =>
      `  total += input > ${statementIndex} ? ${statementIndex + 1} : ${statementIndex};`,
  ).join('\n');
  return `${importStatement}export const value = ${baseExpression};

export function compute${index}(input: number): number {
  let total = value;
${statements}
  return total;
}
`;
}

function relativeImport(fromPath: string, toPath: string): string {
  const fromDirectory = path.posix.dirname(fromPath);
  const targetWithoutExtension = toPath.replace(/\.ts$/u, '');
  const relative = path.posix.relative(fromDirectory, targetWithoutExtension);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

async function writeFixtureFile(
  rootPath: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(rootPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writeInBatches<T>(
  items: readonly T[],
  batchSize: number,
  write: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize);
    await Promise.all(batch.map((item, index) => write(item, offset + index)));
  }
}

function validateOptions(options: RepositoryBenchmarkFixtureOptions): void {
  for (const [name, value] of [
    ['analyzableFileCount', options.analyzableFileCount],
    ['unsupportedFileCount', options.unsupportedFileCount ?? 0],
    ['statementsPerFile', options.statementsPerFile ?? 1],
    ['moduleCount', options.moduleCount ?? 1],
  ] as const) {
    if (!Number.isInteger(value) || value < (name === 'unsupportedFileCount' ? 0 : 1)) {
      throw new Error(`${name} must be a valid benchmark fixture size`);
    }
  }
}

function formatIndex(index: number): string {
  return index.toString().padStart(6, '0');
}
