import { describe, expect, it } from 'vitest';
import { COMMAND_IDS, EXTENSION_ID, VIEW_IDS } from '../constants.js';

describe('shared constants', () => {
  it('keeps every exported command identifier unique and namespaced', () => {
    const commandIds = Object.values(COMMAND_IDS);

    expect(new Set(commandIds).size).toBe(commandIds.length);
    expect(commandIds.every((commandId) => commandId.startsWith('project-dna.'))).toBe(true);
  });

  it('keeps every exported view identifier unique', () => {
    const viewIds = Object.values(VIEW_IDS);

    expect(new Set(viewIds).size).toBe(viewIds.length);
  });

  it('matches the manifest-derived extension identifier', () => {
    expect(EXTENSION_ID).toBe('project-dna.vscode-extension');
  });

  it('matches the contributed sidebar webview identifier', () => {
    expect(VIEW_IDS.sidebar).toBe('project-dna.sidebar.webview');
  });
});
