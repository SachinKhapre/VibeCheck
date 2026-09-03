import { useLayoutEffect, useRef } from 'react';
import { ensureModelContext, fail, type ToolDefinition } from './modelContext';

/**
 * Registers tools on mount and unregisters on unmount.
 *
 * Teardown goes through an AbortController: `registerTool` resolves to nothing,
 * and aborting the signal it was given is what removes the tool.
 *
 * `defs` is read through a ref so tool bodies always see current board state
 * without re-registering on every render.
 */
export function useTools(defs: ToolDefinition[], onRegistered?: (names: string[]) => void) {
  const latest = useRef(defs);
  latest.current = defs;

  // Register before the browser paints. ChatGPT's site-tool snapshot can run
  // immediately after navigation and must see the tools on that first pass.
  useLayoutEffect(() => {
    const controller = new AbortController();

    (async () => {
      const mc = await ensureModelContext();
      if (!mc) {
        console.warn('[vibecheck] No model context available. Serve over HTTPS — it is [SecureContext].');
        return;
      }
      if (controller.signal.aborted) return;

      const registered: string[] = [];
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
          await mc.registerTool(stable, { signal: controller.signal });
          registered.push(def.name);
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error(`[vibecheck] failed to register ${def.name}`, err);
        }
      }
      if (!controller.signal.aborted) onRegistered?.(registered);
    })();

    return () => controller.abort();
    // Registered once for the life of the component; bodies read state via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
