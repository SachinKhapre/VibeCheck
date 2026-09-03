import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill';
import App from './App';
import './index.css';

// Site-tool consumers inspect the page very early. Initialize the local
// WebMCP surface before React mounts so the first tool registrations are not
// racing the browser's initial page inspection. Native WebMCP is preserved by
// the polyfill initializer when it is already available.
initializeWebMCPPolyfill();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
