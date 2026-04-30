// Standalone demo entry. Boots the iframe host against a sample artifact so
// you can verify the picker / annotate / edit flow without sanstudio.
//
// In sanstudio, you don't need this file — call mountIframePanel directly
// from your shell with your own iframe element.

import { mountIframePanel } from './host';

const panelHost = document.getElementById('panel');
const iframe = document.getElementById('artifact') as HTMLIFrameElement | null;
if (!panelHost || !iframe) {
  throw new Error('demo: missing #panel or #artifact');
}

mountIframePanel({
  panelHost,
  iframe,
  // Served from the demo's public dir at build time; vite dev serves this
  // path via the second config entry (vite.iframe.config.ts).
  companionUrl: '/companion.iife.js',
  targetOrigin: '*',
});
