import { createContext, useContext, type ReactNode } from 'react';
import type { Settings, SettingsPatch } from '../shared/settings';
import type { TabRecord, Workspace } from '../shared/types';

export interface DashboardData {
  records: TabRecord[];
  /** User-facing name: "groups". Stored as workspaces. */
  workspaces: Workspace[];
  wsMap: Map<string, Workspace>;
  settings: Settings;
  saveSettings: (patch: SettingsPatch) => Promise<void>;
  windows: chrome.windows.Window[];
  /** Live text in the toolbar search field; lists filter by it as you type. */
  query: string;
  openRelated: (r: TabRecord) => void;
}

const Ctx = createContext<DashboardData | null>(null);

export function DataProvider({ value, children }: { value: DashboardData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DashboardData {
  const v = useContext(Ctx);
  if (!v) throw new Error('DataProvider missing');
  return v;
}

export const isLive = (r: TabRecord) => r.status === 'open' || r.status === 'sleeping';
