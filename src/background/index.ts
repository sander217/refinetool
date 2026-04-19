import type { ExtensionMessage, RefineModeResponse } from '../shared/messages';
import { STORAGE_KEYS } from '../shared/types';

chrome.runtime.onInstalled.addListener(() => {
  // Clicking the toolbar icon opens the side panel (side panel is the primary UI).
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[IFL] setPanelBehavior failed', err));
});

// Per-tab refine-mode state. Ephemeral — service workers can die; the panel
// re-queries `GET_REFINE_MODE` on mount and after refine-mode changes.
const refineModeByTab = new Map<number, boolean>();

async function ensureContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const contentScriptFiles = manifest.content_scripts?.[0]?.js ?? [];
  if (contentScriptFiles.length === 0) {
    throw new Error('No content script files declared in the manifest.');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: contentScriptFiles,
  });
}

async function setRefineMode(tabId: number, enabled: boolean) {
  refineModeByTab.set(tabId, enabled);
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: 'SET_REFINE_MODE',
      enabled,
    } satisfies ExtensionMessage);
  } catch (err) {
    // Content script isn't available on chrome://, Web Store, or new-tab pages.
    console.warn('[IFL] tabs.sendMessage failed (restricted page)', err);
  }
  // Broadcast so the panel UI stays in sync.
  chrome.runtime
    .sendMessage({ type: 'REFINE_MODE_CHANGED', tabId, enabled } satisfies ExtensionMessage)
    .catch(() => {
      /* no active listener — fine */
  });
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

async function clearPendingForTab(tabId: number): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.pending);
  const pending = result[STORAGE_KEYS.pending] as { tabId?: number } | undefined;
  if (pending?.tabId !== tabId) return;

  await chrome.storage.local.remove(STORAGE_KEYS.pending);
  refineModeByTab.set(tabId, false);
  chrome.runtime
    .sendMessage({ type: 'REFINE_MODE_CHANGED', tabId, enabled: false } satisfies ExtensionMessage)
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  if (msg.type === 'SET_REFINE_MODE') {
    const fromTabId = sender.tab?.id;
    if (typeof fromTabId === 'number') {
      void setRefineMode(fromTabId, msg.enabled).then(() => sendResponse({ ok: true }));
      return true;
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async ([tab]) => {
      if (tab?.id != null) {
        await setRefineMode(tab.id, msg.enabled);
        sendResponse({ ok: true, tabId: tab.id });
      } else {
        sendResponse({ ok: false, error: 'No active tab' });
      }
    });
    return true;
  }

  if (msg.type === 'GET_REFINE_MODE') {
    void getActiveTabId().then((tabId) => {
      const enabled = typeof tabId === 'number' ? refineModeByTab.get(tabId) ?? false : false;
      sendResponse({ enabled } satisfies RefineModeResponse);
    });
    return true;
  }

  if (msg.type === 'TARGET_SELECTED') {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'No source tab for selection' });
      return true;
    }

    void chrome.storage.local
      .set({ [STORAGE_KEYS.pending]: { ...msg.payload, tabId } })
      .then(() => {
        sendResponse({ ok: true });
      });
    return true;
  }

  if (msg.type === 'REVERT_DIFFS') {
    void getActiveTabId().then(async (tabId) => {
      if (tabId == null) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      try {
        await ensureContentScript(tabId);
        const result = (await chrome.tabs.sendMessage(tabId, msg)) as
          | { ok?: boolean; error?: string }
          | undefined;
        sendResponse(result ?? { ok: true });
      } catch (err) {
        console.warn('[IFL] REVERT_DIFFS failed', err);
        sendResponse({ ok: false, error: 'Unable to reach the page content script.' });
      }
    });
    return true;
  }

  if (msg.type === 'APPLY_DIRECT_EDIT') {
    void getActiveTabId().then(async (tabId) => {
      if (tabId == null) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }

      try {
        await ensureContentScript(tabId);
        const result = (await chrome.tabs.sendMessage(tabId, msg)) as
          | { ok: boolean; pending?: unknown; error?: string }
          | undefined;

        if (!result?.ok) {
          sendResponse({ ok: false, error: result?.error ?? 'Edit action failed' });
          return;
        }

        if (msg.action.type === 'reset_pending_selection') {
          await chrome.storage.local.remove(STORAGE_KEYS.pending);
        } else if (result.pending) {
          await chrome.storage.local.set({ [STORAGE_KEYS.pending]: result.pending });
        }

        sendResponse(result);
      } catch (err) {
        console.warn('[IFL] APPLY_DIRECT_EDIT failed', err);
        sendResponse({ ok: false, error: 'Unable to reach the page content script.' });
      }
    });
    return true;
  }

  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  refineModeByTab.delete(tabId);
  void clearPendingForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  void clearPendingForTab(tabId);
});
