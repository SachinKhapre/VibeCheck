import { useEffect, useRef } from 'react';
import { ensureModelContext, fail, unregisterFrom, type ToolDefinition } from './modelContext';

/**
 * Registers tools on mount and unregisters on unmount.
 *
 * `defs` is read through a ref so tool bodies always see current board state
 * without re-registering on every render.
 */
export function useTools(defs: ToolDefinition[], onRegistered?: (names: string[]) => void) {
  const latest = useRef(defs);
  latest.current = defs;

  useEffect(() => {
    let cancelled = false;
    const handles: unknown[] = [];

    (async () => {
      const mc = await ensureModelContext();
      if (!mc || cancelled) {
        if (!mc) console.warn('[sift] No model context available. Serve over HTTPS — it is [SecureContext].');
        return;
      }
      for (const def of latest.current) {
        const stable: ToolDefinition = {
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          execute: async (args: unknown) => {
            const current = latest.current.find((d) => d.name === def.name);
            if (!current) return fail('tool_unavailable', `${def.name} is no longer registered.`);
            try {
              return await current.execute(args);
            } catch (err) {
              return fail('tool_failed', err instanceof Error ? err.message : String(err));
            }
          },
        };
        try {
          handles.push(mc.registerTool(stable));
        } catch (err) {
          console.error(`[sift] failed to register ${def.name}`, err);
        }
      }
      onRegistered?.(latest.current.map((d) => d.name));
    })();

    return () => {
      cancelled = true;
      for (const h of handles) {
        try {
          unregisterFrom(h);
        } catch {
          /* nothing useful to do on teardown */
        }
      }
    };
    // Registered once for the life of the component; bodies read state via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
