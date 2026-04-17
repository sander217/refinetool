import type { ExtensionMessage, RefineModeResponse } from '../shared/messages';
import { DIRECT_EDIT_MESSAGE_TYPES } from '../shared/messages';
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

async function setRefineMode(tabId: number, enabled: boolean) {
  refineModeByTab.set(tabId, enabled);
  try {
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
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => {
      const tabId = tab?.id;
      const enabled = typeof tabId === 'number' ? refineModeByTab.get(tabId) ?? false : false;
      sendResponse({ enabled } satisfies RefineModeResponse);
    });
    return true;
  }

  if (DIRECT_EDIT_MESSAGE_TYPES.has(msg.type)) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async ([tab]) => {
      if (tab?.id == null) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      try {
        const response = await chrome.tabs.sendMessage(tab.id, msg);
        sendResponse(response);
      } catch (err) {
        sendResponse({
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Content script unavailable on this page.',
        });
      }
    });
    return true;
  }

  if (msg.type === 'TARGET_SELECTED') {
    void chrome.storage.local
      .set({ [STORAGE_KEYS.pending]: msg.payload })
      .then(() => {
        const tabId = sender.tab?.id;
        if (typeof tabId === 'number') {
          refineModeByTab.set(tabId, false);
          chrome.runtime
            .sendMessage({
              type: 'REFINE_MODE_CHANGED',
              tabId,
              enabled: false,
            } satisfies ExtensionMessage)
            .catch(() => {});
        }
        sendResponse({ ok: true });
      });
    return true;
  }

  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  refineModeByTab.delete(tabId);
});
