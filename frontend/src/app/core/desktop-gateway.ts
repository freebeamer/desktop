import { Injectable } from '@angular/core';
import {
  ApplyCellOperation,
  ChooseAndOpenWorkspace,
  ChooseAndSaveAs,
  CloseWorkspace,
  GetDiff,
  GetMap,
  GetWorkspace,
  Health,
  ListMaps,
  OpenWorkspace,
  RecentWorkspaces,
  Redo,
  SaveAs,
  SetCell,
  SetIndex,
  Undo,
  VerifyChecksums,
} from '../../../wailsjs/go/main/App';
import type { types } from '../../../wailsjs/go/models';

export abstract class DesktopGateway {
  abstract health(): Promise<types.HealthStatus>;
  abstract chooseAndOpenWorkspace(): Promise<types.WorkspaceSummary>;
  abstract openWorkspace(xdfPath: string, binPath: string): Promise<types.WorkspaceSummary>;
  abstract getWorkspace(): Promise<types.WorkspaceSummary>;
  abstract closeWorkspace(): Promise<void>;
  abstract recentWorkspaces(): Promise<types.RecentEntry[]>;
  abstract listMaps(filter: types.MapFilter): Promise<types.MapPage>;
  abstract getMap(mapId: number): Promise<types.MapDetail>;
  abstract applyCellOperation(request: types.CellOperationRequest): Promise<types.BatchEditOutcome>;
  abstract setCell(mapId: number, row: number, column: number, value: number): Promise<types.EditOutcome>;
  abstract setIndex(mapId: number, index: number, value: number): Promise<types.EditOutcome>;
  abstract undo(): Promise<types.EditOutcome>;
  abstract redo(): Promise<types.EditOutcome>;
  abstract getDiff(): Promise<types.DiffSummary>;
  abstract verifyChecksums(): Promise<types.ChecksumSummary>;
  abstract saveAs(path: string): Promise<types.SaveOutcome>;
  abstract chooseAndSaveAs(): Promise<types.SaveOutcome>;
}

@Injectable({ providedIn: 'root' })
export class WailsDesktopGateway implements DesktopGateway {
  health(): Promise<types.HealthStatus> {
    return Health();
  }

  chooseAndOpenWorkspace(): Promise<types.WorkspaceSummary> {
    return ChooseAndOpenWorkspace();
  }

  openWorkspace(xdfPath: string, binPath: string): Promise<types.WorkspaceSummary> {
    return OpenWorkspace(xdfPath, binPath);
  }

  getWorkspace(): Promise<types.WorkspaceSummary> {
    return GetWorkspace();
  }

  closeWorkspace(): Promise<void> {
    return CloseWorkspace();
  }

  recentWorkspaces(): Promise<types.RecentEntry[]> {
    return RecentWorkspaces();
  }

  listMaps(filter: types.MapFilter): Promise<types.MapPage> {
    return ListMaps(filter);
  }

  getMap(mapId: number): Promise<types.MapDetail> {
    return GetMap(mapId);
  }

  applyCellOperation(request: types.CellOperationRequest): Promise<types.BatchEditOutcome> {
    return ApplyCellOperation(request);
  }

  setCell(mapId: number, row: number, column: number, value: number): Promise<types.EditOutcome> {
    return SetCell(mapId, row, column, value);
  }

  setIndex(mapId: number, index: number, value: number): Promise<types.EditOutcome> {
    return SetIndex(mapId, index, value);
  }

  undo(): Promise<types.EditOutcome> {
    return Undo();
  }

  redo(): Promise<types.EditOutcome> {
    return Redo();
  }

  getDiff(): Promise<types.DiffSummary> {
    return GetDiff();
  }

  verifyChecksums(): Promise<types.ChecksumSummary> {
    return VerifyChecksums();
  }

  saveAs(path: string): Promise<types.SaveOutcome> {
    return SaveAs(path);
  }

  chooseAndSaveAs(): Promise<types.SaveOutcome> {
    return ChooseAndSaveAs();
  }
}
