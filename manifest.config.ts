import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Interface Finetuning Layer',
  version: pkg.version,
  description: pkg.description,
  action: {
    default_title: 'Interface Finetuning Layer — open side panel',
  },
  side_panel: {
    default_path: 'src/panel/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'sidePanel', 'activeTab', 'scripting'],
  host_permissions: ['<all_urls>'],
});
