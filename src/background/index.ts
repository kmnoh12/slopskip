import { MESSAGE_TYPES } from "../shared/messages";
import { getStorageState, migrateStorageState, patchSettings } from "../shared/storage";
import type { ExtensionSettings } from "../shared/types";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const state = await getStorageState();
    await chrome.storage.local.set(migrateStorageState(state));
  } catch (error) {
    console.error("[SlopSkip]", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === MESSAGE_TYPES.SET_SETTINGS) {
    void patchSettings((message.payload ?? {}) as Partial<ExtensionSettings>)
      .then((state) => {
        sendResponse({ ok: true, settings: state.settings });
      })
      .catch((error) => {
        console.error("[SlopSkip]", error);
        sendResponse({ ok: false });
      });
    return true;
  }

  return false;
});
