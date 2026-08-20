import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommitGitError, type IProjectDNAService } from '@project-dna/dna-core';
import { Err, ExtensionMessageSchema, Ok } from '@project-dna/shared';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: () => ({ toString: () => 'vscode-resource' }),
    file: (fsPath: string) => ({ fsPath }),
  },
  commands: { executeCommand: vi.fn() },
  workspace: { openTextDocument: vi.fn() },
  window: { showTextDocument: vi.fn() },
}));

import { SidebarProvider } from '../sidebar/sidebar-provider.js';
import { isPathInside } from '../sidebar/sidebar-provider.js';
import * as vscode from 'vscode';

describe('SidebarProvider navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts nested targets only when they remain inside the workspace', () => {
    expect(isPathInside('C:/repo', 'C:/repo/src/index.ts')).toBe(true);
    expect(isPathInside('C:/repo', 'C:/other/index.ts')).toBe(false);
    expect(isPathInside('C:/repo', 'C:/repo/../secrets.txt')).toBe(false);
    expect(isPathInside('C:/repo', 'C:/repo/..')).toBe(false);
  });

  it('opens files and reveals directories from the active workspace', async () => {
    const root = await createTemporaryWorkspace();
    const sourceDirectory = join(root, 'src');
    const sourceFile = join(sourceDirectory, 'index.ts');
    await mkdir(sourceDirectory);
    await writeFile(sourceFile, 'export {};');
    const canonicalSourceDirectory = await realpath(sourceDirectory);
    const canonicalSourceFile = await realpath(sourceFile);
    vi.mocked(vscode.workspace.openTextDocument).mockImplementation(async (uri) => uri as never);

    const harness = createHarness({ rootPath: root });
    harness.resolve();
    harness.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'src/index.ts' });
    await harness.waitForWorkspaceTargetResultCount(1);
    harness.receive({ type: 'openWorkspaceTarget', requestId: 1, path: 'src' });
    await harness.waitForWorkspaceTargetResultCount(2);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonicalSourceFile }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(expect.anything(), {
      preview: true,
    });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'revealInExplorer',
      expect.objectContaining({ fsPath: canonicalSourceDirectory }),
    );
    expect(harness.workspaceTargetResults().map(({ outcome }) => outcome)).toEqual([
      'opened',
      'opened',
    ]);
    await rm(root, { force: true, recursive: true });
  });

  it('reports missing targets and ignores duplicate or disposed-view requests', async () => {
    const root = await createTemporaryWorkspace();
    const harness = createHarness({ rootPath: root });
    const firstView = harness.resolve();
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'missing.ts' });
    await harness.waitForWorkspaceTargetResultCount(1);
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'other.ts' });
    harness.disposeView();
    firstView.receive({ type: 'openWorkspaceTarget', requestId: 1, path: 'other.ts' });
    await Promise.resolve();

    expect(harness.workspaceTargetResults()).toEqual([
      expect.objectContaining({ requestId: 0, path: 'missing.ts', outcome: 'missing' }),
    ]);
    await rm(root, { force: true, recursive: true });
  });

  it('does not open a target after the active workspace changes', async () => {
    const root = await createTemporaryWorkspace();
    const sourceFile = join(root, 'index.ts');
    await writeFile(sourceFile, 'export {};');
    let currentRoot = root;
    const harness = createHarness({ getRootPath: () => currentRoot });
    harness.resolve();
    currentRoot = join(root, 'replacement');
    harness.receive({ type: 'openWorkspaceTarget', requestId: 0, path: 'index.ts' });
    await Promise.resolve();

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    await rm(root, { force: true, recursive: true });
  });

  it('publishes bounded entity details for the requested analysis version', async () => {
    const service = createService({
      currentVersion: 3,
      entity: {
        id: 'entity-1',
        kind: 'file',
        name: 'Repository service',
        path: 'src/service.ts',
        purpose: 'Coordinates repository access',
        architectureRole: 'service',
        businessDomain: 'repositories',
        importance: 0.9,
        criticality: 'high',
        complexity: 8,
        healthScore: 0.85,
        risks: Array.from({ length: 110 }, (_, index) => `risk-${index}`),
        dependsOn: Array.from({ length: 110 }, (_, index) => `dependency-${index}`),
        dependedOnBy: ['consumer-1'],
        belongsToDomain: null,
        belongsToLayer: null,
        knowledgeNodeIds: ['knowledge-1'],
        knowledgeDensity: 0.8,
        confidence: 0.9,
        lastAnalyzedAt: 1,
      },
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEntityDetail',
      requestId: 4,
      analysisVersion: 3,
      entityId: 'entity-1',
    });
    await harness.waitForEntityDetailCount(1);

    const [detail] = harness.entityDetails();
    expect(detail).toEqual(
      expect.objectContaining({
        requestId: 4,
        analysisVersion: 3,
        entityId: 'entity-1',
        entity: expect.objectContaining({ path: 'src/service.ts' }),
      }),
    );
    expect(detail?.entity?.dependencies).toHaveLength(100);
    expect(detail?.entity?.risks).toHaveLength(100);
  });

  it('rejects stale entity versions and ignores results after view disposal', async () => {
    const deferred = createDeferred<ReturnType<typeof Ok<never>>>();
    const service = createService({ currentVersion: 2 });
    service.getEntity = vi.fn(() => deferred.promise as never);
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEntityDetail',
      requestId: 0,
      analysisVersion: 1,
      entityId: 'stale',
    });
    await harness.waitForEntityDetailCount(1);
    expect(harness.entityDetails()[0]).toEqual(
      expect.objectContaining({ entity: null, error: 'Analysis version is no longer current.' }),
    );

    harness.receive({
      type: 'requestEntityDetail',
      requestId: 1,
      analysisVersion: 2,
      entityId: 'pending',
    });
    harness.disposeView();
    deferred.resolve(Ok(null) as never);
    await Promise.resolve();
    expect(harness.entityDetails()).toHaveLength(1);
  });

  it('publishes only the latest versioned impact request and cancels the superseded query', async () => {
    const first = createDeferred<ReturnType<typeof Ok<never>>>();
    const second = createDeferred<ReturnType<typeof Ok<never>>>();
    const signals: AbortSignal[] = [];
    const service = createService({ currentVersion: 3 });
    service.getImpact = vi.fn((_target, _options, signal) => {
      signals.push(signal!);
      return (signals.length === 1 ? first.promise : second.promise) as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 1,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    harness.receive({
      type: 'requestImpact',
      requestId: 2,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/b.ts' },
    });
    expect(signals[0]?.aborted).toBe(true);

    first.resolve(Ok(impactResult('src/a.ts', 3)) as never);
    second.resolve(Ok(impactResult('src/b.ts', 3)) as never);
    await harness.waitForImpactResultCount(1);

    expect(harness.impactResults()[0]).toMatchObject({
      requestId: 2,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/b.ts' },
      result: { target: { path: 'src/b.ts' } },
    });
  });

  it('publishes a bounded working-tree impact DTO and forwards cancellation', async () => {
    const pending = createDeferred<ReturnType<typeof Ok<never>>>();
    let signal: AbortSignal | undefined;
    const service = createService({ currentVersion: 3 });
    service.getWorkingTreeImpact = vi.fn((_options, candidate) => {
      signal = candidate;
      return pending.promise as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({ type: 'requestWorkingTreeImpact', requestId: 8, analysisVersion: 3 });
    expect(service.getWorkingTreeImpact).toHaveBeenCalledOnce();
    expect(signal).toBeInstanceOf(AbortSignal);
    pending.resolve(Ok(workingTreeImpactResult(3)) as never);
    await harness.waitForWorkingTreeImpactResultCount(1);
    expect(harness.workingTreeImpactResults()[0]).toMatchObject({
      requestId: 8,
      analysisVersion: 3,
      result: {
        headCommit: 'a'.repeat(40),
        changedPaths: [expect.objectContaining({ path: 'src/changed.ts', staged: true })],
      },
    });
    harness.receive({ type: 'cancelWorkingTreeImpact', requestId: 8 });
    expect(signal?.aborted).toBe(false);
  });

  it('filters unsupported legacy working-tree reasons at the webview boundary', async () => {
    const service = createService({ currentVersion: 3 });
    service.getWorkingTreeImpact = vi.fn(async () => {
      const result = workingTreeImpactResult(3);
      return Ok({
        ...result,
        unresolvedPaths: [
          ...result.unresolvedPaths,
          {
            path: 'src/legacy.ts',
            side: 'before' as const,
            reason: 'legacy-analysis-state-unavailable' as const,
          },
        ],
      }) as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({ type: 'requestWorkingTreeImpact', requestId: 9, analysisVersion: 3 });
    await harness.waitForWorkingTreeImpactResultCount(1);

    const result = harness.workingTreeImpactResults()[0]?.result;
    expect(result?.unresolvedPaths).toEqual([
      expect.objectContaining({ reason: 'analysis-refresh-required' }),
    ]);
    expect(result?.warnings).toContain(
      'Legacy working-tree analysis state is unsupported by this UI boundary.',
    );
  });

  it('cancels a superseded working-tree request and suppresses its late result', async () => {
    const first = createDeferred<ReturnType<typeof Ok<never>>>();
    const second = createDeferred<ReturnType<typeof Ok<never>>>();
    const signals: AbortSignal[] = [];
    const service = createService({ currentVersion: 3 });
    service.getWorkingTreeImpact = vi.fn((_options, candidate) => {
      signals.push(candidate!);
      return (signals.length === 1 ? first.promise : second.promise) as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({ type: 'requestWorkingTreeImpact', requestId: 1, analysisVersion: 3 });
    harness.receive({ type: 'requestWorkingTreeImpact', requestId: 2, analysisVersion: 3 });
    expect(signals[0]?.aborted).toBe(true);
    first.resolve(Ok(workingTreeImpactResult(3)) as never);
    second.resolve(Ok(workingTreeImpactResult(3)) as never);
    await harness.waitForWorkingTreeImpactResultCount(1);
    expect(harness.workingTreeImpactResults()[0]?.requestId).toBe(2);
  });

  it('publishes historical commit impact without depending on the current analysis version', async () => {
    const commitSha = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const service = createService({ currentVersion: 3 });
    service.getCommitImpact = vi.fn(
      async () => Ok(commitImpactResult(commitSha, parentSha)) as never,
    );
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({ type: 'requestCommitImpact', requestId: 12, commitSha });
    await harness.waitForCommitImpactResultCount(1);

    expect(service.getCommitImpact).toHaveBeenCalledWith(
      { commitSha },
      undefined,
      expect.any(AbortSignal),
    );
    expect(harness.commitImpactResults()[0]).toMatchObject({
      requestId: 12,
      repositoryId: 'repo',
      commitSha,
      selectedParentSha: parentSha,
      parentCommits: [parentSha],
      requiresParentSelection: false,
      result: { commitSha, selectedParentSha: parentSha },
    });
  });

  it('returns direct merge parents for explicit selection without starting a combined diff', async () => {
    const commitSha = 'a'.repeat(40);
    const parents = ['b'.repeat(40), 'c'.repeat(40)];
    const service = createService({ currentVersion: 3 });
    service.getCommitImpact = vi.fn(
      async () =>
        Err(
          new CommitGitError(
            'Merge commits require an explicit direct parent SHA',
            'ambiguous-merge-parent',
          ),
        ) as never,
    );
    const commitMetadataProvider = {
      getCommitParents: vi.fn(async () => Ok(parents)),
    };
    const harness = createHarness({ service, commitMetadataProvider });
    harness.resolve();
    harness.receive({ type: 'requestCommitImpact', requestId: 13, commitSha });
    await harness.waitForCommitImpactResultCount(1);

    expect(commitMetadataProvider.getCommitParents).toHaveBeenCalledWith(
      'C:/repo',
      commitSha,
      expect.any(AbortSignal),
    );
    expect(harness.commitImpactResults()[0]).toMatchObject({
      requestId: 13,
      commitSha,
      selectedParentSha: null,
      parentCommits: parents,
      requiresParentSelection: true,
      result: null,
      error: undefined,
    });
  });

  it('cancels superseded commit requests and suppresses cancelled or disposed results', async () => {
    const first = createDeferred<ReturnType<typeof Ok<never>>>();
    const second = createDeferred<ReturnType<typeof Ok<never>>>();
    const signals: AbortSignal[] = [];
    const service = createService({ currentVersion: 3 });
    service.getCommitImpact = vi.fn((_request, _options, signal) => {
      signals.push(signal!);
      return (signals.length === 1 ? first.promise : second.promise) as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({ type: 'requestCommitImpact', requestId: 1, commitSha: 'a'.repeat(40) });
    harness.receive({ type: 'requestCommitImpact', requestId: 2, commitSha: 'b'.repeat(40) });
    expect(signals[0]?.aborted).toBe(true);
    first.resolve(Ok(commitImpactResult('a'.repeat(40), 'c'.repeat(40))) as never);
    harness.receive({ type: 'cancelCommitImpact', requestId: 2 });
    expect(signals[1]?.aborted).toBe(true);
    second.resolve(Ok(commitImpactResult('b'.repeat(40), 'd'.repeat(40))) as never);
    await Promise.resolve();
    expect(harness.commitImpactResults()).toHaveLength(0);

    const pending = createDeferred<ReturnType<typeof Ok<never>>>();
    service.getCommitImpact = vi.fn(() => pending.promise as never);
    harness.receive({ type: 'requestCommitImpact', requestId: 3, commitSha: 'e'.repeat(40) });
    harness.disposeView();
    pending.resolve(Ok(commitImpactResult('e'.repeat(40), 'f'.repeat(40))) as never);
    await Promise.resolve();
    expect(harness.commitImpactResults()).toHaveLength(0);
  });

  it('rejects stale impact versions and suppresses disposed or failed deliveries', async () => {
    const service = createService({ currentVersion: 4 });
    service.getImpact = vi.fn(async () => Ok(impactResult('src/a.ts', 4)) as never);
    const harness = createHarness({ service, postResults: [false] });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 1,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    await harness.waitForImpactResultCount(1);
    expect(service.getImpact).not.toHaveBeenCalled();
    expect(harness.impactResults()[0]).toMatchObject({
      result: null,
      error: 'Analysis version is no longer current.',
    });

    const pending = createDeferred<ReturnType<typeof Ok<never>>>();
    service.getImpact = vi.fn(() => pending.promise as never);
    harness.receive({
      type: 'requestImpact',
      requestId: 2,
      analysisVersion: 4,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    harness.disposeView();
    pending.resolve(Ok(impactResult('src/a.ts', 4)) as never);
    await Promise.resolve();
    expect(harness.impactResults()).toHaveLength(1);
  });

  it('cancels an active impact query without publishing its late result', async () => {
    const pending = createDeferred<ReturnType<typeof Ok<never>>>();
    let signal: AbortSignal | undefined;
    const service = createService({ currentVersion: 3 });
    service.getImpact = vi.fn((_target, _options, candidate) => {
      signal = candidate;
      return pending.promise as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 3,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    harness.receive({ type: 'cancelImpact', requestId: 3 });
    expect(signal?.aborted).toBe(true);
    pending.resolve(Ok(impactResult('src/a.ts', 3)) as never);
    await Promise.resolve();
    expect(harness.impactResults()).toEqual([]);
  });

  it('cancels an active impact query when analysis refresh begins', async () => {
    const pending = createDeferred<ReturnType<typeof Ok<never>>>();
    let progressListener:
      ((progress: { stage: string; message: string; percent: number }) => void) | undefined;
    let signal: AbortSignal | undefined;
    const service = createService({ currentVersion: 3 });
    service.onProgress = vi.fn((listener) => {
      progressListener = listener as (progress: {
        stage: string;
        message: string;
        percent: number;
      }) => void;
      return () => undefined;
    });
    service.getImpact = vi.fn((_target, _options, candidate) => {
      signal = candidate;
      return pending.promise as never;
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 6,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    progressListener?.({ stage: 'scanning', message: 'Scanning', percent: 0 });
    expect(signal?.aborted).toBe(true);
    pending.resolve(Ok(impactResult('src/a.ts', 3)) as never);
    await Promise.resolve();
    expect(harness.impactResults()).toEqual([]);
  });

  it('restarts a restored impact request after webview recreation', async () => {
    const first = createDeferred<ReturnType<typeof Ok<never>>>();
    const service = createService({ currentVersion: 3 });
    const signals: AbortSignal[] = [];
    service.getImpact = vi.fn((_target, _options, signal) => {
      signals.push(signal!);
      return signals.length === 1
        ? (first.promise as never)
        : Promise.resolve(Ok(impactResult('src/a.ts', 3)) as never);
    });
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 4,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    harness.resolve();
    expect(signals[0]?.aborted).toBe(true);
    harness.receive({
      type: 'requestImpact',
      requestId: 4,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    await harness.waitForImpactResultCount(1);
    first.resolve(Ok(impactResult('src/a.ts', 3)) as never);
    await Promise.resolve();
    expect(harness.impactResults()).toHaveLength(1);
  });

  it('contains impact result delivery failures without changing query behavior', async () => {
    const service = createService({ currentVersion: 3 });
    service.getImpact = vi.fn(async () => Ok(impactResult('src/a.ts', 3)) as never);
    const harness = createHarness({ service, throwOnPostTypes: ['impactResult'] });
    harness.resolve();
    harness.receive({
      type: 'requestImpact',
      requestId: 5,
      analysisVersion: 3,
      target: { kind: 'file', path: 'src/a.ts' },
    });
    await harness.waitForImpactResultCount(1);
    expect(service.getImpact).toHaveBeenCalledOnce();
  });

  it('publishes a deterministic bounded evolution comparison', async () => {
    const service = createService({ currentVersion: 4 });
    service.getDiff = vi.fn(async () =>
      Ok({
        fromVersion: 2,
        toVersion: 4,
        timestamp: 1,
        addedEntities: ['z', 'a'],
        removedEntities: ['y', 'b'],
        modifiedEntities: [
          { entityId: 'z', changes: [{ field: 'purpose', from: '', to: 'new' }] },
          { entityId: 'a', changes: [{ field: 'healthScore', from: 0, to: 1 }] },
        ],
        healthDelta: { overall: 4, dimensions: { risk: 2, architecture: 1 } },
        newRisks: ['risk-z', 'risk-a'],
        resolvedRisks: [],
        addedEdges: 2,
        removedEdges: 1,
        newDomains: ['sales'],
        removedDomains: [],
        architecturalSignificance: 0.4,
      }),
    );
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 2,
      analysisVersion: 4,
      fromVersion: 2,
      toVersion: 4,
    });
    await harness.waitForEvolutionComparisonCount(1);

    expect(harness.evolutionComparisons()[0]?.comparison).toEqual(
      expect.objectContaining({ addedEntities: ['a', 'z'], removedEntities: ['b', 'y'] }),
    );
    expect(
      harness
        .evolutionComparisons()[0]
        ?.comparison?.changedEntities.map(({ entityId }) => entityId),
    ).toEqual(['a', 'z']);
  });

  it('rejects same-version and stale evolution comparisons without querying diffs', async () => {
    const service = createService({ currentVersion: 4 });
    service.getDiff = vi.fn();
    const harness = createHarness({ service });
    harness.resolve();
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 0,
      analysisVersion: 3,
      fromVersion: 2,
      toVersion: 4,
    });
    harness.receive({
      type: 'requestEvolutionComparison',
      requestId: 1,
      analysisVersion: 4,
      fromVersion: 4,
      toVersion: 4,
    });
    await harness.waitForEvolutionComparisonCount(2);
    expect(service.getDiff).not.toHaveBeenCalled();
  });

  it('delivers navigation while the webview is already resolved and ready', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('keeps navigation pending until an unresolved webview becomes ready', async () => {
    const harness = createHarness();
    harness.provider.navigateTo('architecture');
    harness.resolve();

    expect(harness.navigationMessages()).toEqual([]);
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('restores the acknowledged route after webview recreation without echoing it', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()[0]).toEqual({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });

    harness.disposeView();
    harness.clearMessages();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'knowledge', generation: 0, revision: 1 });
    await vi.waitFor(() => expect(harness.unavailableMessages()).toHaveLength(1));

    expect(harness.navigationMessages()).toEqual([]);
  });

  it('ignores stale and duplicate webview navigation without creating echo loops', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });
    await harness.waitForNavigationCount(1);
    harness.clearMessages();

    harness.receive({
      type: 'navigateTo',
      route: 'architecture',
      generation: 0,
      revision: 0,
      requestId: 1,
    });
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });
    await Promise.resolve();
    expect(harness.navigationMessages()).toEqual([]);

    harness.receive({
      type: 'navigateTo',
      route: 'dependencies',
      generation: 0,
      revision: 1,
      requestId: 1,
    });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      { type: 'navigateTo', route: 'dependencies', generation: 0, revision: 2, requestId: 1 },
    ]);
  });

  it('keeps command navigation authoritative when a webview message races with it', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 0,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('advances a same-route command revision and rejects the queued webview request', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationCount(1);
    harness.clearMessages();

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 2,
        requestId: undefined,
      },
    ]);
  });

  it('rebases a MAX_SAFE_INTEGER revision and rejects pre-rollover requests', async () => {
    const harness = createHarness();
    harness.resolve();
    harness.receive({
      type: 'ready',
      route: 'architecture',
      generation: 0,
      revision: Number.MAX_SAFE_INTEGER,
    });
    await harness.waitForNavigationCount(0);

    harness.provider.navigateTo('architecture');
    harness.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: Number.MAX_SAFE_INTEGER,
      requestId: 0,
    });

    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 1,
        revision: 0,
        requestId: undefined,
      },
    ]);
  });

  it('retries an undelivered navigation when the webview is recreated', async () => {
    const harness = createHarness({ postResults: [true, false, true] });
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationAttempts(1);
    harness.disposeView();
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationAttempts(2);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('does not let a late successful delivery suppress the replacement webview', async () => {
    const oldDelivery = createDeferred<boolean>();
    const harness = createHarness({ navigationPostResults: [oldDelivery.promise, true] });
    harness.resolve();
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);

    harness.provider.navigateTo('architecture');
    await harness.waitForNavigationAttempts(1);
    harness.disposeView();
    harness.resolve();

    oldDelivery.resolve(true);
    await oldDelivery.promise;
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });

    await harness.waitForNavigationAttempts(2);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });

  it('ignores messages emitted by a disposed webview', async () => {
    const harness = createHarness();
    const firstView = harness.resolve();
    firstView.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForUnavailableCount(1);
    harness.disposeView();

    harness.resolve();
    harness.provider.navigateTo('architecture');
    firstView.receive({ type: 'ready', route: 'knowledge', generation: 0, revision: 9 });
    firstView.receive({
      type: 'navigateTo',
      route: 'knowledge',
      generation: 0,
      revision: 1,
      requestId: 0,
    });
    await Promise.resolve();

    expect(harness.navigationMessages()).toEqual([]);
    harness.receive({ type: 'ready', route: 'overview', generation: 0, revision: 0 });
    await harness.waitForNavigationCount(1);
    expect(harness.navigationMessages()).toEqual([
      {
        type: 'navigateTo',
        route: 'architecture',
        generation: 0,
        revision: 1,
        requestId: undefined,
      },
    ]);
  });
});

function createHarness(
  options: {
    postResults?: boolean[];
    navigationPostResults?: Array<boolean | Promise<boolean>>;
    rootPath?: string;
    getRootPath?: () => string | undefined;
    service?: IProjectDNAService;
    throwOnPostTypes?: string[];
    commitMetadataProvider?: {
      getCommitParents(rootPath: string, commitSha: string, signal?: AbortSignal): Promise<unknown>;
    };
  } = {},
) {
  const service = options.service ?? createService();
  const messages: unknown[] = [];
  let receiveMessage: ((message: unknown) => void) | undefined;
  let disposeView: (() => void) | undefined;
  const postResults = [...(options.postResults ?? [])];
  const navigationPostResults = [...(options.navigationPostResults ?? [])];
  const throwOnPostTypes = new Set(options.throwOnPostTypes ?? []);
  const provider = new SidebarProvider(
    { toString: () => 'extension-uri' } as never,
    service,
    options.getRootPath ?? (() => options.rootPath ?? 'C:/repo'),
    options.commitMetadataProvider as never,
  );

  return {
    provider,
    resolve() {
      let viewReceiveMessage: ((message: unknown) => void) | undefined;
      provider.resolveWebviewView(
        {
          onDidDispose: (listener: () => void) => {
            disposeView = listener;
            return { dispose() {} };
          },
          webview: {
            options: {},
            html: '',
            cspSource: 'vscode-webview:',
            asWebviewUri: () => ({ toString: () => 'vscode-resource' }),
            onDidReceiveMessage: (listener: (message: unknown) => void) => {
              receiveMessage = listener;
              viewReceiveMessage = listener;
              return { dispose() {} };
            },
            postMessage: async (message: unknown) => {
              messages.push(message);
              if (
                typeof message === 'object' &&
                message !== null &&
                'type' in message &&
                typeof message.type === 'string' &&
                throwOnPostTypes.has(message.type)
              ) {
                throw new Error(`Failed to deliver ${message.type}`);
              }
              if (
                typeof message === 'object' &&
                message !== null &&
                'type' in message &&
                message.type === 'navigateTo'
              ) {
                return (await navigationPostResults.shift()) ?? true;
              }
              return postResults.shift() ?? true;
            },
          },
        } as never,
        {} as never,
        {} as never,
      );
      return {
        receive(message: unknown) {
          if (!viewReceiveMessage) throw new Error('Webview is not resolved');
          viewReceiveMessage(message);
        },
      };
    },
    receive(message: unknown) {
      if (!receiveMessage) throw new Error('Webview is not resolved');
      receiveMessage(message);
    },
    disposeView() {
      if (!disposeView) throw new Error('Webview is not resolved');
      disposeView();
    },
    clearMessages() {
      messages.length = 0;
    },
    navigationMessages() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'navigateTo');
    },
    unavailableMessages() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'analysisUnavailable');
    },
    workspaceTargetResults() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'workspaceTargetResult');
    },
    entityDetails() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'entityDetail');
    },
    evolutionComparisons() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'evolutionComparison');
    },
    impactResults() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'impactResult');
    },
    workingTreeImpactResults() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'workingTreeImpactResult');
    },
    commitImpactResults() {
      return messages
        .map((message) => ExtensionMessageSchema.parse(message))
        .filter((message) => message.type === 'commitImpactResult');
    },
    async waitForNavigationCount(count: number) {
      if (count === 0) {
        await this.waitForUnavailableCount(1);
        return;
      }
      await vi.waitFor(() => expect(this.navigationMessages()).toHaveLength(count));
    },
    async waitForNavigationAttempts(count: number) {
      await vi.waitFor(() => expect(this.navigationMessages()).toHaveLength(count));
    },
    async waitForUnavailableCount(count: number) {
      await vi.waitFor(() => expect(this.unavailableMessages()).toHaveLength(count));
    },
    async waitForWorkspaceTargetResultCount(count: number) {
      await vi.waitFor(() => expect(this.workspaceTargetResults()).toHaveLength(count));
    },
    async waitForEntityDetailCount(count: number) {
      await vi.waitFor(() => expect(this.entityDetails()).toHaveLength(count));
    },
    async waitForEvolutionComparisonCount(count: number) {
      await vi.waitFor(() => expect(this.evolutionComparisons()).toHaveLength(count));
    },
    async waitForImpactResultCount(count: number) {
      await vi.waitFor(() => expect(this.impactResults()).toHaveLength(count));
    },
    async waitForWorkingTreeImpactResultCount(count: number) {
      await vi.waitFor(() => expect(this.workingTreeImpactResults()).toHaveLength(count));
    },
    async waitForCommitImpactResultCount(count: number) {
      await vi.waitFor(() => expect(this.commitImpactResults()).toHaveLength(count));
    },
  };
}

function createService(options: { currentVersion?: number; entity?: unknown } = {}) {
  return {
    onProgress() {
      return () => undefined;
    },
    onReady() {
      return () => undefined;
    },
    getCurrent() {
      return Ok(options.currentVersion ? { id: 'repo', version: options.currentVersion } : null);
    },
    async getEntity() {
      return Ok(options.entity ?? null);
    },
    async getWorkingTreeImpact() {
      return Ok(workingTreeImpactResult(options.currentVersion ?? 3));
    },
  } as unknown as IProjectDNAService;
}

function commitImpactResult(commitSha: string, parentSha: string | null) {
  const digest = 'd'.repeat(64);
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const before = {
    kind: 'git-commit' as const,
    repositoryId: 'repo',
    commitSha: parentSha,
    treeSha: parentSha ?? emptyTree,
    parentCommitSha: null,
    parentTreeSha: null,
    analysisConfigFingerprint: digest,
    contentFingerprint: digest,
    source: 'materialized' as const,
  };
  const after = {
    ...before,
    commitSha,
    treeSha: commitSha,
    parentCommitSha: parentSha,
    parentTreeSha: parentSha,
  };
  return {
    repositoryId: 'repo',
    commitSha,
    parentCommits: parentSha ? [parentSha] : [],
    parentCommitSha: parentSha,
    changedFiles: [
      {
        kind: 'modified' as const,
        path: 'src/changed.ts',
        oldBlobSha: parentSha,
        newBlobSha: commitSha,
        oldMode: '100644',
        newMode: '100644',
        contentKind: 'text' as const,
        binary: false,
        gitlink: false,
      },
    ],
    before,
    after,
    changeSet: {
      fromVersion: 0,
      toVersion: 1,
      addedEntityIds: [],
      removedEntityIds: [],
      modifiedEntities: [],
      addedRelationships: [],
      removedRelationships: [],
      modifiedRelationships: [],
      addedDomainIds: [],
      removedDomainIds: [],
      modifiedDomains: [],
      addedRiskIds: [],
      resolvedRiskIds: [],
      modifiedRisks: [],
      domainMembershipChanges: [],
      architectureMembershipChanges: [],
      unavailableCollections: [],
    },
    impacts: [
      {
        side: 'after' as const,
        path: 'src/changed.ts',
        entityId: 'file:src/changed.ts',
        sourceAvailable: true,
        provenance: after,
        result: impactResult('src/changed.ts', 1),
      },
    ],
    summary: {
      changedEntityIds: ['file:src/changed.ts'],
      impactedEntityIds: [],
      directDependentIds: [],
      transitiveDependentIds: [],
      domainIds: [],
      capabilityIds: [],
      criticalComponentIds: [],
      riskIds: [],
      architectureLayers: [],
      boundaryEvidence: [],
      highestScore: 0,
    },
    unresolved: [],
    warnings: [],
    complete: true,
    truncations: [],
  };
}

async function createTemporaryWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'project-dna-sidebar-'));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function impactResult(path: string, analysisVersion: number) {
  return {
    repositoryId: 'repo',
    analysisVersion,
    target: { id: `file:${path}`, kind: 'file' as const, name: path, path, minimumDepth: 0 },
    directImpactedEntities: [],
    transitiveImpactedEntities: [],
    minimumDepth: null,
    canonicalPaths: [],
    semanticEffects: {
      domains: [],
      capabilities: [],
      criticalComponents: [],
      risks: [],
      architecture: { layers: [], boundaryCrossings: [] },
    },
    score: {
      total: 0,
      components: [
        'dependency-reach',
        'critical-component-exposure',
        'domain-reach',
        'risk-exposure',
        'architecture-boundaries',
      ].map((kind) => ({
        kind,
        rawInput: 0,
        normalizedValue: 0,
        weight: 0,
        contribution: 0,
        evidenceIds: [],
        status: 'available',
      })),
    },
    evidence: [],
    warnings: [],
    complete: true,
    truncations: [],
    appliedBounds: { maxDepth: 8, maxEntities: 500, maxEvidencePaths: 1 },
  };
}

function workingTreeImpactResult(analysisVersion: number) {
  return {
    repositoryId: 'repo',
    headCommit: 'a'.repeat(40),
    changedPaths: [
      {
        kind: 'modified' as const,
        path: 'src/changed.ts',
        staged: true,
        unstaged: false,
        untracked: false,
        contentKind: 'text' as const,
      },
    ],
    resolvedTargets: [],
    unresolvedPaths: [
      {
        path: 'src/changed.ts',
        side: 'after' as const,
        reason: 'analysis-refresh-required' as const,
      },
    ],
    impacts: [],
    changedEntityIds: [],
    impactedEntityIds: [],
    changeSet: null,
    beforeAnalysisVersion: analysisVersion,
    afterAnalysisVersion: null,
    warnings: ['analysis-refresh-required'],
    complete: false,
    truncations: [],
  };
}
