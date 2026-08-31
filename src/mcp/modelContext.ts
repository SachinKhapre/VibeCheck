/**
 * WebMCP binding.
 *
 * The current docs use `document.modelContext`; the older W3C proposal text uses
 * `navigator.modelContext`. Bind to whichever exists so we work either way.
 * Both are [SecureContext] — over plain HTTP this is undefined and we no-op.
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: any) => Promise<ToolResult> | ToolResult;
}

interface ModelContextLike {
  registerTool(tool: ToolDefinition): unknown;
}

export function getModelContext(): ModelContextLike | null {
  if (typeof document !== 'undefined' && (document as any).modelContext) return (document as any).modelContext;
  if (typeof navigator !== 'undefined' && (navigator as any).modelContext) return (navigator as any).modelContext;
  return null;
}

/** Loads the polyfill only when the browser has no native model context. */
export async function ensureModelContext(): Promise<ModelContextLike | null> {
  const native = getModelContext();
  if (native) return native;
  try {
    await import('@mcp-b/webmcp-polyfill');
  } catch (err) {
    console.warn('[sift] WebMCP polyfill failed to load', err);
  }
  return getModelContext();
}

/** registerTool has returned an unregister function, a disposable, or nothing across versions. */
export function unregisterFrom(handle: unknown): void {
  if (typeof handle === 'function') {
    (handle as () => void)();
    return;
  }
  const h = handle as { unregister?: () => void; dispose?: () => void; remove?: () => void } | null;
  h?.unregister?.() ?? h?.dispose?.() ?? h?.remove?.();
}

export function ok(text: string, structuredContent?: unknown): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/** Agents surface structured errors to the user; silent failures are the listed footgun. */
export function fail(code: string, message: string): ToolResult {
  return { content: [{ type: 'text', text: `${code}: ${message}` }], structuredContent: { error: code, message }, isError: true };
}
