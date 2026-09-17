import { Injectable } from '@angular/core';
import {
  ConnectLive,
  CreateLivePairingLink,
  DisconnectLive,
  GetLiveCatalog,
  ListLiveClients,
  LiveConnectionStatus,
  SetLiveDeviceSession,
} from '../../../wailsjs/go/main/App';
import { EventsOn } from '../../../wailsjs/runtime/runtime';
import type { types } from '../../../wailsjs/go/models';

// Event-only DTOs are not emitted by the Wails binding generator.
export interface LiveSource {
  bindingRevision?: string;
  deviceId: string;
  sessionId: string;
}
export interface LiveSample extends LiveSource {
  sequence: number;
  timestamp: string;
  values: Record<string, number>;
  backfill: boolean;
  gapBefore: number;
}
export interface LiveBatch {
  generation: number;
  samples: LiveSample[] | null;
  sources: LiveSource[] | null;
}
export const sourceKey = (source: LiveSource): string =>
  JSON.stringify([source.deviceId, source.sessionId]);

@Injectable({ providedIn: 'root' })
export class LiveGateway {
  connect(url: string, token: string, client: string) {
    return ConnectLive(url, token, client);
  }
  disconnect() {
    return DisconnectLive();
  }
  clients(url: string, token: string) {
    return ListLiveClients(url, token);
  }
  createPairingLink(url: string, token: string, displayName: string) {
    return CreateLivePairingLink(url, token, displayName);
  }
  catalog() {
    return GetLiveCatalog();
  }
  select(source: LiveSource) {
    return SetLiveDeviceSession(source.deviceId, source.sessionId);
  }
  status() {
    return LiveConnectionStatus();
  }
  onStatus(handler: (status: types.LiveConnectionStatus) => void): () => void {
    return EventsOn('live:status', handler);
  }
  onBatch(handler: (batch: LiveBatch) => void): () => void {
    return EventsOn('live:samples', handler);
  }
}
