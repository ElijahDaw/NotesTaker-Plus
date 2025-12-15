import type { CameraState, CanvasPath, CanvasTextNode } from '../components/CanvasViewport';

export interface NoteDocument {
  version: number;
  exportedAt: string;
  camera: CameraState;
  paths: CanvasPath[];
  textNodes: CanvasTextNode[];
  strokeColor: string;
  strokeScale: number;
  defaultTextScale: number | null;
  defaultTextFont: string;
}

export interface NoteBridgeSavePayload {
  document: NoteDocument;
  fileName: string;
}

export type NoteBridgeSaveResult =
  | { status: 'saved'; path: string; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type NoteBridgeOpenResult =
  | { status: 'opened'; path: string; fileName: string; document: NoteDocument }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface SavedNoteMetadata {
  fileName: string;
  path: string;
  updatedAt: number;
  document?: NoteDocument | null;
}

export type NoteBridgeListResult =
  | { status: 'ok'; files: SavedNoteMetadata[] }
  | { status: 'error'; message: string };

export type NoteBridgeImportResult =
  | { status: 'imported'; files: SavedNoteMetadata[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface NoteBridge {
  saveDocument: (payload: NoteBridgeSavePayload) => Promise<NoteBridgeSaveResult>;
  openDocument: () => Promise<NoteBridgeOpenResult>;
  listDocuments: () => Promise<NoteBridgeListResult>;
  importDocuments: () => Promise<NoteBridgeImportResult>;
}
