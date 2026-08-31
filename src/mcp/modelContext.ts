/**
 * WebMCP binding.
 *
 * The current docs use `document.modelContext`; the older W3C proposal text uses
 * `navigator.modelContext`. Bind to whichever exists so we work either way — the
 * polyfill installs `document.modelContext` and keeps `navigator.modelContext` as a
 * deprecated alias, so document is checked first.
 *
 * Both are [SecureContext]: over plain HTTP this is undefined and we no-op.
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

export interface RegisterOptions {
  /** Aborting unregisters the tool. This is the only teardown path the polyfill offers. */
  signal?: AbortSignal;
}

export interface ModelContextLike {
  registerTool(tool: ToolDefinition, options?: RegisterOptions): unknown;
}

export function getModelContext(): ModelContextLike | null {
  if (typeof document !== 'undefined' && (document as any).modelContext) return (document as any).modelContext;
  if (typeof navigator !== 'undefined' && (navigator as any).modelContext) return (navigator as any).modelContext;
  return null;
}

/**
 * Loads and initializes the polyfill only when the browser has no native model context.
 * The ESM build does not self-install — it has to be told to.
 */
export async function ensureModelContext(): Promise<ModelContextLike | null> {
  const native = getModelContext();
  if (native) return native;
  try {
    const { initializeWebMCPPolyfill } = await import('@mcp-b/webmcp-polyfill');
    initializeWebMCPPolyfill();
  } catch (err) {
    console.warn('[sift] WebMCP polyfill unavailable', err);
  }
  return getModelContext();
}

export function ok(text: string, structuredContent?: unknown): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}

/** Agents surface structured errors to the user; silent failures are the listed footgun. */
export function fail(code: string, message: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: code, message },
    isError: true,
  };
}
