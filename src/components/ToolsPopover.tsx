import { useEffect, useRef, useState } from 'react';
import type { ToolDefinition } from '../mcp/modelContext';

interface Props {
  tools: ToolDefinition[];
  /** Names that actually made it onto the model context. */
  registered: string[];
  demo: boolean;
}

/**
 * The agent-status chip, opened.
 *
 * The board's claim is that an agent works on the same state you do — so the tools it
 * has should be readable, not hidden behind a title attribute. Names are shown exactly
 * as the agent sees them, and a tool that failed to register says so rather than being
 * quietly omitted.
 */
export function ToolsPopover({ tools, registered, demo }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const connected = registered.length > 0;

  // Escape and click-outside — the two things a popover has to get right.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="tools-wrap" ref={wrap}>
      {demo && <span className="chip">recorded gather</span>}
      <button
        type="button"
        className={`chip ${connected ? 'live' : ''} ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {connected ? `agent connected · ${registered.length} tools` : 'connecting agent…'}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="tools-panel" role="dialog" aria-label="WebMCP tools on this page">
          <header>
            <h3>webmcp tools</h3>
            <p>
              {connected
                ? 'Registered on this page. Your agent can call any of them, and everything it does lands in the activity rail.'
                : 'Nothing registered yet. WebMCP is [SecureContext] — over plain HTTP the page runs without agent tools.'}
            </p>
          </header>

          <ul>
            {tools.map((tool) => {
              const live = registered.includes(tool.name);
              return (
                <li key={tool.name} className={live ? 'on' : 'off'}>
                  <code>{tool.name}</code>
                  {!live && <span className="pending">not registered</span>}
                  <p>{firstSentence(tool.description)}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Tool descriptions are written for the model and run long; the panel wants the gist. */
function firstSentence(description: string): string {
  const end = description.indexOf('. ');
  return end === -1 ? description : description.slice(0, end + 1);
}
