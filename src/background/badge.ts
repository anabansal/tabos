import { db } from '../shared/db';
import { getSettings } from './context';

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced toolbar badge update with the number of open (including sleeping) tabs. */
export function scheduleBadge(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void updateBadge();
  }, 400);
}

export async function updateBadge(): Promise<void> {
  try {
    const settings = await getSettings();
    if (settings.ui.badge === 'none') {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const n = await db.tabs.where('status').anyOf(['open', 'sleeping']).count();
    await chrome.action.setBadgeBackgroundColor({ color: '#3a3f4b' });
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    await chrome.action.setBadgeText({ text: n > 999 ? '999+' : n > 0 ? String(n) : '' });
  } catch {
    /* badge is cosmetic */
  }
}
