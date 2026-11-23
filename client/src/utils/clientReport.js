// Tell the server which builds this install runs (v2.146.0), so an admin can
// see which versions are in use (Settings → ADMINISTRATION → CLIENT VERSIONS).
// Sent once per page load, under a random id kept on this device. The server
// stores no account with it.

import { API_URL, VERSION } from '../config/constants.js';
import { getInstalledApp } from './installedApp.js';

const INSTALL_ID_KEY = 'cortex_install_id';
let sent = false;

function installId() {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export async function reportClientVersion(authToken) {
  if (sent || !authToken) return;
  const id = installId();
  if (!id) return;
  sent = true;
  try {
    const app = await getInstalledApp();
    const platform = app ? app.kind : isStandalone() ? 'pwa' : 'web';
    await fetch(`${API_URL}/clients/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ installId: id, platform, webVersion: VERSION, appVersion: app?.version || null }),
    });
  } catch {
    sent = false; // try again next time
  }
}
