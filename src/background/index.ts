import { MESSAGE_TYPES } from "../shared/messages";
import { getStorageState, migrateStorageState, patchSettings } from "../shared/storage";
import type { ExtensionSettings } from "../shared/types";

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getStorageState();
  await chrome.storage.local.set(migrateStorageState(state));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  if (message.type === MESSAGE_TYPES.SET_SETTINGS) {
    void patchSettings((message.payload ?? {}) as Partial<ExtensionSettings>).then((state) => {
      sendResponse({ ok: true, settings: state.settings });
    });
    return true;
  }

  return false;
});
