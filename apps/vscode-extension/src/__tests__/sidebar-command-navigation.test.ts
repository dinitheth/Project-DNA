import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_IDS, VIEW_IDS, type SidebarRoute } from '@project-dna/shared';

const vscodeState = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  operations: [] as string[],
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, command: () => Promise<void>) => {
      vscodeState.commands.set(id, command);
      return { dispose() {} };
    },
    executeCommand: async (id: string) => {
      vscodeState.operations.push(`focus:${id}`);
    },
  },
}));

import { registerOpenArchitectureCommand } from '../commands/open-architecture.js';
import { registerOpenKnowledgeGraphCommand } from '../commands/open-knowledge-graph.js';

describe('sidebar navigation commands', () => {
  beforeEach(() => {
    vscodeState.commands.clear();
    vscodeState.operations.length = 0;
  });

  it('focuses the sidebar and targets Architecture', async () => {
    const provider = createProvider();
    registerOpenArchitectureCommand(createContext(), provider.value);

    await vscodeState.commands.get(COMMAND_IDS.openArchitecture)?.();

    expect(vscodeState.operations).toEqual([
      `focus:${VIEW_IDS.sidebar}.focus`,
      'navigate:architecture',
    ]);
    expect(provider.routes).toEqual(['architecture']);
  });

  it('focuses the sidebar and targets Knowledge Graph', async () => {
    const provider = createProvider();
    registerOpenKnowledgeGraphCommand(createContext(), provider.value);

    await vscodeState.commands.get(COMMAND_IDS.openKnowledgeGraph)?.();

    expect(vscodeState.operations).toEqual([
      `focus:${VIEW_IDS.sidebar}.focus`,
      'navigate:knowledge',
    ]);
    expect(provider.routes).toEqual(['knowledge']);
  });
});

function createContext() {
  return { subscriptions: { push() {} } } as never;
}

function createProvider() {
  const routes: SidebarRoute[] = [];
  return {
    routes,
    value: {
      navigateTo(route: SidebarRoute) {
        routes.push(route);
        vscodeState.operations.push(`navigate:${route}`);
      },
    } as never,
  };
}
