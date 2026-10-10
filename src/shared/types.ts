// Domain model shared by the service worker and the UI.

export type TabStatus = 'open' | 'sleeping' | 'archived' | 'closed';

export type CloseReason =
  | 'user' // closed by the user in Chrome
  | 'window-closed' // closed because its window closed (also happens at browser shutdown)
  | 'missing' // vanished while TabOS was not watching (e.g. crash), found during reconcile
  | 'duplicate' // closed by TabOS duplicate cleanup, at the user's request
  | 'tabos'; // closed through TabOS by the user

export type GroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export const GROUP_COLORS: GroupColor[] = ['blue', 'green', 'orange', 'purple', 'cyan', 'pink', 'red', 'yellow', 'grey'];

/** Where a tab lived before it was archived or closed, so it can be put back. */
export interface RestoreHint {
  windowId?: number;
  index?: number;
  pinned?: boolean;
  groupTitle?: string;
  groupColor?: GroupColor;
}

/** Optional page metadata, only collected when the user enables it. Never page body text. */
export interface PageMeta {
  description?: string;
  keywords?: string;
  siteName?: string;
  collectedAt: number;
}

export interface TabRecord {
  id: string;
  /** Live Chrome tab id. Null when the tab is archived/closed. Ids are only valid within one browser session. */
  chromeTabId: number | null;
  windowId: number | null;
  index: number;
  url: string;
  normalizedUrl: string;
  title: string;
  favIconUrl: string;
  domain: string;
  status: TabStatus;
  workspaceId: string | null;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  active: boolean;
  /** Chrome tab group id (-1 = none). Session-scoped like tab ids. */
  groupId: number;
  isProtected: boolean;
  createdAt: number;
  lastActiveAt: number;
  updatedAt: number;
  activations: number;
  sleptAt: number | null;
  archivedAt: number | null;
  archiveReason: string | null;
  closedAt: number | null;
  closeReason: CloseReason | null;
  restoreHint: RestoreHint | null;
  meta: PageMeta | null;
  /** URL at which auto-organize last evaluated this tab, so it isn't re-sorted until it navigates. */
  sortCheckedUrl?: string | null;
  /** Workspace was set automatically (inherited or auto-organized), so auto-organize may move it. */
  autoAssigned?: boolean;
}

export type WorkspaceSource = 'manual' | 'ai' | 'tab-group' | 'import';

export interface Workspace {
  id: string;
  name: string;
  color: GroupColor;
  summary: string;
  source: WorkspaceSource;
  isProtected: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
}

export interface SnapshotTab {
  url: string;
  title: string;
  favIconUrl: string;
  pinned: boolean;
  groupKey: string | null;
  recordId: string | null;
  workspaceId: string | null;
}

export interface SnapshotGroup {
  key: string;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface SnapshotWindow {
  tabs: SnapshotTab[];
  groups: SnapshotGroup[];
}

export interface Snapshot {
  id: string;
  name: string;
  kind: 'manual' | 'auto' | 'workspace';
  createdAt: number;
  windows: SnapshotWindow[];
  /** Workspaces referenced by the snapshot, so they can be recreated if deleted since. */
  workspaces: Array<Pick<Workspace, 'id' | 'name' | 'color' | 'summary'>>;
  tabCount: number;
  /** Stable fingerprint used to skip identical auto snapshots. */
  fingerprint: string;
}

// ---------- Activity log & undo ----------

export interface TabPlacement {
  recordId: string;
  hint: RestoreHint | null;
}

export type UndoPayload =
  | { type: 'reopen'; placements: TabPlacement[] } // undo archive / close
  | { type: 'wake'; recordIds: string[] } // undo sleep
  | { type: 'reclose'; items: Array<{ recordId: string; prevStatus: 'archived' | 'closed' }> } // undo restore
  | {
      type: 'assign';
      changes: Array<{ recordId: string; prevWorkspaceId: string | null }>;
      createdWorkspaceIds: string[];
      renamedWorkspaces?: Array<{ id: string; name: string; summary: string }>;
    }
  | { type: 'workspace-restore'; workspace: Workspace; recordIds: string[]; hadChromeGroups: boolean }
  | { type: 'records-restore'; records: TabRecord[] }
  | { type: 'snapshot-restore'; snapshot: Snapshot }
  | { type: 'protect'; changes: Array<{ recordId: string; prev: boolean }> }
  | { type: 'composite'; parts: UndoPayload[] };

export type ActivityKind =
  | 'sleep'
  | 'wake'
  | 'archive'
  | 'auto-archive'
  | 'restore'
  | 'close'
  | 'duplicates'
  | 'assign'
  | 'organize'
  | 'workspace'
  | 'snapshot'
  | 'delete'
  | 'protect'
  | 'import'
  | 'clean';

export interface ActivityEntry {
  id: string;
  at: number;
  kind: ActivityKind;
  label: string;
  count: number;
  undo: UndoPayload | null;
  undoneAt: number | null;
}

// ---------- AI organization ----------

export interface ProposedGroup {
  id: string;
  name: string;
  summary: string;
  color: GroupColor;
  recordIds: string[];
  /** When set, the group maps onto an existing workspace instead of creating one. */
  existingWorkspaceId: string | null;
  confidence: number;
  basis: string;
}

export interface OrganizeProposal {
  id: string;
  createdAt: number;
  providerLabel: string;
  groups: ProposedGroup[];
  unassigned: string[];
}

export interface OrganizeApplyRequest {
  groups: Array<Pick<ProposedGroup, 'name' | 'summary' | 'color' | 'recordIds' | 'existingWorkspaceId'>>;
  createChromeGroups: boolean;
}

// ---------- Cleaning ----------

export interface CleanCandidate {
  recordId: string;
  reasons: string[];
  score: number;
}

export interface CleanPreview {
  generatedAt: number;
  sleep: CleanCandidate[];
  archive: CleanCandidate[];
  duplicates: DuplicateGroup[];
  protectedCount: number;
}

export interface DuplicateGroup {
  normalizedUrl: string;
  keepRecordId: string;
  recordIds: string[];
}

export interface MemoryReading {
  capacityBytes: number;
  availableBytes: number;
  at: number;
}
