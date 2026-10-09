// Future integration interface for bringing AI-assistant conversations (chat apps)
// into TabOS search and workspaces.
//
// Deliberately NOT implemented in this version. TabOS never scrapes conversation pages: the
// metadata collector hard-blocks AI chat domains (see background/metadata.ts NEVER_READ_DOMAINS).
// An integration may only be added if it uses a supported, permission-compliant channel, e.g.:
//   - an official export the user downloads and imports by choosing the file
//   - an official API the user authorizes with their own credentials (OAuth / API key)
//   - a documented share/permalink format the user pastes explicitly
// and it must declare exactly what it reads and where data goes, behind explicit consent.

export type IntegrationChannel = 'user-file-import' | 'official-api' | 'user-pasted-link';

export interface ConversationRef {
  /** Stable id within the source. */
  id: string;
  source: string;
  title: string;
  /** Link that opens the conversation in its own app (never fetched by TabOS). */
  url: string;
  createdAt: number;
  updatedAt: number;
  /** Optional short user-visible summary; never the full transcript. */
  summary?: string;
}

export interface IntegrationManifest {
  id: string;
  name: string;
  channel: IntegrationChannel;
  /** Human-readable list of exactly what is read, shown before consent. */
  reads: string[];
  /** Whether any data leaves the device, and to where. */
  dataLeavesDevice: false | { destination: string };
  /** Chrome permissions requested at connect time (optional permissions only). */
  optionalPermissions: chrome.runtime.ManifestPermission[];
  optionalOrigins: string[];
}

export interface ConversationSourceIntegration {
  manifest: IntegrationManifest;
  /** True once the user has connected/consented and any required permissions are granted. */
  isConnected(): Promise<boolean>;
  /** Must be called from a user gesture; requests permissions and records consent. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** For 'user-file-import': parse a file the user picked. Other channels: list via the official API. */
  listConversations(input?: File): Promise<ConversationRef[]>;
}

/** Registry of available integrations. Empty in this version by design. */
export const INTEGRATIONS: ConversationSourceIntegration[] = [];
