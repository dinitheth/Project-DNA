/**
 * Typed message protocol for webview ↔ extension host communication.
 *
 * Design decisions:
 * - Discriminated union on the 'type' field for compile-time exhaustiveness.
 * - Zod schemas at the boundary for runtime validation of untrusted webview messages.
 * - Separate types for extension→webview and webview→extension directions.
 * - MessageEnvelope wraps payloads with correlation IDs for request/response patterns.
 */

import { z } from 'zod';

// ─── Extension → Webview Messages ───────────────────────────────────

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('analysisStarted'),
    rootPath: z.string(),
  }),
  z.object({
    type: z.literal('analysisProgress'),
    stage: z.string(),
    message: z.string(),
    percent: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal('analysisComplete'),
    summary: z.object({
      fileCount: z.number(),
      languageCount: z.number(),
      architecturePattern: z.string(),
      knowledgeNodeCount: z.number(),
      durationMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal('analysisError'),
    message: z.string(),
    stage: z.string().optional(),
  }),
  z.object({
    type: z.literal('repositoryData'),
    data: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('architectureData'),
    data: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('dependencyData'),
    data: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('knowledgeData'),
    data: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('themeChanged'),
    kind: z.enum(['light', 'dark', 'high-contrast']),
  }),
]);

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;

// ─── Webview → Extension Messages ───────────────────────────────────

export const WebviewMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('requestAnalysis'),
  }),
  z.object({
    type: z.literal('requestRefresh'),
  }),
  z.object({
    type: z.literal('requestRepositoryData'),
  }),
  z.object({
    type: z.literal('requestArchitectureData'),
  }),
  z.object({
    type: z.literal('requestDependencyData'),
  }),
  z.object({
    type: z.literal('requestKnowledgeData'),
  }),
  z.object({
    type: z.literal('navigateTo'),
    view: z.enum(['overview', 'architecture', 'knowledge', 'dependencies', 'settings']),
  }),
  z.object({
    type: z.literal('updateSettings'),
    settings: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('ready'),
  }),
]);

export type WebviewMessage = z.infer<typeof WebviewMessageSchema>;

// ─── Message Envelope ───────────────────────────────────────────────

/**
 * Optional envelope for request/response correlation.
 * Used when a webview request expects a specific response.
 */
export interface MessageEnvelope<T = ExtensionMessage | WebviewMessage> {
  /** Unique correlation ID for request/response matching. */
  readonly correlationId: string;
  /** The actual message payload. */
  readonly payload: T;
  /** ISO timestamp of when the message was created. */
  readonly timestamp: string;
}
