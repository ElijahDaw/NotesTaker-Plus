import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CanvasViewport, {
  CameraState,
  CanvasMode,
  CanvasPath,
  CanvasTextNode,
  COLLAB_PRESENCE_EVENT,
  COLLAB_ROOM_BEGIN_EVENT,
  COLLAB_ROOM_EVENT,
  DrawTool,
  MAX_ZOOM,
  MIN_ZOOM,
  ShapeTool,
  TextNodeKind,
  ViewportSize,
  WorldPoint,
  type CollaborationRoomChangeDetail
} from './components/CanvasViewport';
import { supabase } from './lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import Toolbar from './components/Toolbar';
import StrokeScaleControl from './components/StrokeScaleControl';
import NoteLibraryOverlay from './components/NoteLibraryOverlay';
import type { NoteDocument, NoteBridgeListResult, SavedNoteMetadata } from './types/note';

const INITIAL_CAMERA: CameraState = {
  x: 0,
  y: 0,
  scale: 1
};
const NOTE_FILE_VERSION = 1;
const AUTOSAVE_INTERVAL_MS = 10 * 60 * 1000;

interface CollaborationSnapshot {
  paths: CanvasPath[];
  textNodes: CanvasTextNode[];
}

interface CollaborationSessionState {
  code: string | null;
  role: 'host' | 'guest' | 'inactive';
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const sanitizeNoteName = (value?: string | null) => {
  if (!value || typeof value !== 'string') {
    return 'note';
  }
  let sanitized = value.trim();
  sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/\.+$/, '');
  return sanitized || 'note';
};

const ensureNoteFileName = (value?: string | null) => {
  const sanitized = sanitizeNoteName(value);
  return sanitized.toLowerCase().endsWith('.ntp') ? sanitized : `${sanitized}.ntp`;
};

interface HistoryState {
  past: CanvasPath[][];
  future: CanvasPath[][];
}

const App = () => {
  const [mode, setMode] = useState<CanvasMode>('draw');
  const [drawTool, setDrawTool] = useState<DrawTool>('pen');
  const [strokeColor, setStrokeColor] = useState('#111827');
  const [strokeScale, setStrokeScale] = useState(0.5);
  const [shapeTool, setShapeTool] = useState<ShapeTool>('freeform');
  const [camera, setCamera] = useState<CameraState>(INITIAL_CAMERA);
  const [paths, setPaths] = useState<CanvasPath[]>([]);
  const [textNodes, setTextNodes] = useState<CanvasTextNode[]>([]);
  const [collaborationSession, setCollaborationSession] = useState<CollaborationSessionState>({
    code: null,
    role: 'inactive'
  });
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [defaultTextScale, setDefaultTextScale] = useState<number | null>(1);
  const [defaultTextFont, setDefaultTextFont] = useState('Inter');
  const [showTextSizeAlert, setShowTextSizeAlert] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isNoteLibraryOpen, setIsNoteLibraryOpen] = useState(false);
  const [noteLibraryFiles, setNoteLibraryFiles] = useState<SavedNoteMetadata[]>([]);
  const [noteLibraryLoading, setNoteLibraryLoading] = useState(false);
  const [noteLibraryError, setNoteLibraryError] = useState<string | null>(null);
  const [noteLibrarySearch, setNoteLibrarySearch] = useState('');
  const textSizeAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGuardRef = useRef(false);
  const textClipboardRef = useRef<CanvasTextNode | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogValue, setSaveDialogValue] = useState('');
  const [saveDialogError, setSaveDialogError] = useState<string | null>(null);
  const collaborationChannelRef = useRef<RealtimeChannel | null>(null);
  const collaborationPeerIdRef = useRef<string | null>(null);
  const collaborationReadyRef = useRef(false);
  const applyingRemoteStateRef = useRef(false);
  const pathsRef = useRef<CanvasPath[]>([]);
  const textNodesRef = useRef<CanvasTextNode[]>([]);
  const fileLabel = useMemo(() => {
    if (!activeFilePath) return null;
    const parts = activeFilePath.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? activeFilePath;
  }, [activeFilePath]);
  const triggerTextSizeAlert = useCallback(() => {
    setShowTextSizeAlert(true);
    if (textSizeAlertTimeoutRef.current) {
      clearTimeout(textSizeAlertTimeoutRef.current);
    }
    textSizeAlertTimeoutRef.current = setTimeout(() => {
      setShowTextSizeAlert(false);
      textSizeAlertTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (textSizeAlertTimeoutRef.current) {
      clearTimeout(textSizeAlertTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  useEffect(() => {
    textNodesRef.current = textNodes;
  }, [textNodes]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRoomChange = (event: Event) => {
      const detail = (event as CustomEvent<CollaborationRoomChangeDetail>).detail;
      setCollaborationSession({ code: detail.code, role: detail.role });
      collaborationPeerIdRef.current = detail.peerId;
      if (!detail.code && collaborationChannelRef.current) {
        void supabase.removeChannel(collaborationChannelRef.current);
        collaborationChannelRef.current = null;
        collaborationReadyRef.current = false;
        window.dispatchEvent(new CustomEvent(COLLAB_PRESENCE_EVENT, { detail: { code: null, count: 0 } }));
      }
    };
    window.addEventListener(COLLAB_ROOM_EVENT, handleRoomChange as EventListener);
    return () => {
      window.removeEventListener(COLLAB_ROOM_EVENT, handleRoomChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRoomBegin = (event: Event) => {
      const detail = (event as CustomEvent<{ code: string }>).detail;
      if (!detail?.code) return;
      const channel = collaborationChannelRef.current;
      const peerId = collaborationPeerIdRef.current;
      if (!channel || !peerId) return;
      void channel.send({
        type: 'broadcast',
        event: 'room-begin',
        payload: { peerId, code: detail.code }
      });
    };
    window.addEventListener(COLLAB_ROOM_BEGIN_EVENT, handleRoomBegin as EventListener);
    return () => window.removeEventListener(COLLAB_ROOM_BEGIN_EVENT, handleRoomBegin as EventListener);
  }, []);

  useEffect(() => {
    const roomCode = collaborationSession.code;
    if (!roomCode) {
      if (collaborationChannelRef.current) {
        collaborationReadyRef.current = false;
        void supabase.removeChannel(collaborationChannelRef.current);
        collaborationChannelRef.current = null;
      }
      return undefined;
    }
    if (!collaborationPeerIdRef.current) {
      collaborationPeerIdRef.current = crypto.randomUUID();
    }
    const peerId = collaborationPeerIdRef.current;
    const channel = supabase.channel(`ntp-room-${roomCode}`, {
      config: {
        broadcast: { ack: true },
        presence: { key: peerId }
      }
    });
    collaborationChannelRef.current = channel;
    const applySnapshot = (snapshot: CollaborationSnapshot) => {
      applyingRemoteStateRef.current = true;
      setPaths(snapshot.paths);
      setTextNodes(snapshot.textNodes);
    };
    const handleBroadcastSnapshot = (payload?: { peerId?: string; payload: CollaborationSnapshot }) => {
      if (!payload || payload.peerId === peerId) return;
      applySnapshot(payload.payload);
    };
    channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (!payload || payload.peerId === peerId) return;
      void channel.send({
        type: 'broadcast',
        event: 'state-sync',
        payload: {
          peerId,
          payload: {
            paths: pathsRef.current,
            textNodes: textNodesRef.current
          }
        }
      });
    });
    channel.on('broadcast', { event: 'state-sync' }, ({ payload }) => handleBroadcastSnapshot(payload));
    channel.on('broadcast', { event: 'state-update' }, ({ payload }) => handleBroadcastSnapshot(payload));
    channel.on('broadcast', { event: 'room-begin' }, ({ payload }) => {
      if (!payload || payload.peerId === peerId) return;
      window.dispatchEvent(new CustomEvent(COLLAB_ROOM_BEGIN_EVENT, { detail: { code: payload.code } }));
    });

    const emitPresence = () => {
      const state = channel.presenceState();
      let count = 0;
      Object.values(state).forEach(entries => {
        if (Array.isArray(entries)) {
          count += entries.length;
        }
      });
      window.dispatchEvent(new CustomEvent(COLLAB_PRESENCE_EVENT, { detail: { code: roomCode, count } }));
    };

    channel.on('presence', { event: 'sync' }, emitPresence);
    channel.on('presence', { event: 'join' }, emitPresence);
    channel.on('presence', { event: 'leave' }, emitPresence);

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        collaborationReadyRef.current = true;
        channel.track({ connectedAt: new Date().toISOString(), role: collaborationSession.role });
        emitPresence();
        void channel.send({ type: 'broadcast', event: 'sync-request', payload: { peerId } });
      }
    });

    return () => {
      collaborationReadyRef.current = false;
      void supabase.removeChannel(channel);
      if (collaborationChannelRef.current === channel) {
        collaborationChannelRef.current = null;
      }
      window.dispatchEvent(new CustomEvent(COLLAB_PRESENCE_EVENT, { detail: { code: roomCode, count: 0 } }));
    };
  }, [collaborationSession.code, collaborationSession.role, setPaths, setTextNodes]);

  useEffect(() => {
    if (!collaborationSession.code) return;
    if (!collaborationReadyRef.current) return;
    if (applyingRemoteStateRef.current) {
      applyingRemoteStateRef.current = false;
      return;
    }
    const channel = collaborationChannelRef.current;
    const peerId = collaborationPeerIdRef.current;
    if (!channel || !peerId) return;
    void channel.send({
      type: 'broadcast',
      event: 'state-update',
      payload: {
        peerId,
        payload: {
          paths,
          textNodes
        }
      }
    });
  }, [collaborationSession.code, paths, textNodes]);


  const handleCreateTextNode = useCallback((point: WorldPoint, kind: TextNodeKind) => {
    if (kind === 'textbox' && defaultTextScale === null) {
      triggerTextSizeAlert();
      return;
    }
    const id = crypto.randomUUID();
    setTextNodes(nodes => [
      ...nodes,
      {
        id,
        x: point.x,
        y: point.y,
        text: '',
        kind,
        fontScale: defaultTextScale ?? 1,
        fontFamily: defaultTextFont,
        fontScaleLocked: false,
        locked: false,
        color: strokeColor
      }
    ]);
    setPendingFocusId(id);
  }, [defaultTextScale, defaultTextFont, strokeColor, triggerTextSizeAlert]);

  const handleUpdateTextNode = useCallback((id: string, text: string) => {
    setTextNodes(nodes =>
      nodes.map(node => (node.id === id ? { ...node, text } : node))
    );
  }, []);

  const handleDeleteTextNode = useCallback((id: string) => {
    setTextNodes(nodes => nodes.filter(node => node.id !== id));
  }, []);

  const handleMoveTextNode = useCallback((id: string, x: number, y: number) => {
    setTextNodes(nodes =>
      nodes.map(node => (node.id === id ? { ...node, x, y } : node))
    );
  }, []);

  const handleResizeTextNode = useCallback((id: string, width: number, height: number, fontScale?: number, fontScaleLocked?: boolean) => {
    setTextNodes(nodes =>
      nodes.map(node => (
        node.id === id
          ? {
              ...node,
              width,
              height,
              ...(fontScale !== undefined ? { fontScale } : {}),
              ...(fontScaleLocked !== undefined ? { fontScaleLocked } : {})
            }
          : node
      ))
    );
  }, []);

  const handleCopyTextNode = useCallback((id: string) => {
    setTextNodes(nodes => {
      const node = nodes.find(entry => entry.id === id);
      if (node) {
        textClipboardRef.current = { ...node };
      }
      return nodes;
    });
  }, []);

  const handleCutTextNode = useCallback((id: string) => {
    setTextNodes(nodes => {
      const node = nodes.find(entry => entry.id === id);
      if (!node) return nodes;
      textClipboardRef.current = { ...node };
      return nodes.filter(entry => entry.id !== id);
    });
  }, []);

  const handleDuplicateTextNode = useCallback((id: string) => {
    setTextNodes(nodes => {
      const node = nodes.find(entry => entry.id === id);
      if (!node) return nodes;
      const duplicate: CanvasTextNode = {
        ...node,
        id: crypto.randomUUID(),
        x: node.x + 32,
        y: node.y + 32,
        width: undefined,
        height: undefined,
        fontScaleLocked: node.fontScaleLocked ?? false,
        locked: false
      };
      setPendingFocusId(duplicate.id);
      return [...nodes, duplicate];
    });
  }, []);

  const handleReorderTextNode = useCallback((id: string, direction: 'forward' | 'backward' | 'front' | 'back') => {
    setTextNodes(nodes => {
      const index = nodes.findIndex(node => node.id === id);
      if (index === -1) return nodes;
      const next = [...nodes];
      const [node] = next.splice(index, 1);
      switch (direction) {
        case 'forward':
          next.splice(Math.min(index + 1, next.length), 0, node);
          break;
        case 'backward':
          next.splice(Math.max(index - 1, 0), 0, node);
          break;
        case 'front':
          next.push(node);
          break;
        case 'back':
          next.unshift(node);
          break;
        default:
          next.splice(index, 0, node);
          break;
      }
      return next;
    });
  }, []);

  const handleDefaultTextScaleChange = useCallback((value: number | null) => {
    setDefaultTextScale(value);
    if (value !== null) {
      setShowTextSizeAlert(false);
    }
  }, []);

  const handleUpdateTextNodeStyle = useCallback((id: string, updates: Partial<Pick<CanvasTextNode, 'fontScale' | 'fontFamily' | 'fontScaleLocked' | 'locked' | 'width' | 'height'>>) => {
    setTextNodes(nodes =>
      nodes.map(node => (node.id === id ? { ...node, ...updates } : node))
    );
  }, []);

  const handleDefaultTextFontChange = useCallback((value: string) => {
    const normalized = value.trim();
    setDefaultTextFont(normalized || 'Inter');
  }, []);

  const handleClearPendingFocus = useCallback(() => {
    setPendingFocusId(null);
  }, []);

  const handleResetView = useCallback(() => {
    setCamera(INITIAL_CAMERA);
  }, []);

  const handleViewportSizeChange = useCallback((size: ViewportSize) => {
    setViewportSize(size);
  }, []);

  const adjustZoom = useCallback(
    (direction: 'in' | 'out') => {
      const stepPercent = 5;
      const minPercent = MIN_ZOOM * 100;
      const maxPercent = MAX_ZOOM * 100;
      setCamera(prevCamera => {
        const currentPercent = prevCamera.scale * 100;
        const normalizedPercent = Math.round(currentPercent * 100) / 100;
        let targetPercent = normalizedPercent;
        const remainder = ((normalizedPercent % stepPercent) + stepPercent) % stepPercent;
        if (direction === 'in') {
          if (normalizedPercent >= maxPercent) return prevCamera;
          const increment = remainder === 0 ? stepPercent : stepPercent - remainder;
          targetPercent = Math.min(normalizedPercent + increment, maxPercent);
        } else {
          if (normalizedPercent <= minPercent) return prevCamera;
          const decrement = remainder === 0 ? stepPercent : remainder;
          targetPercent = Math.max(normalizedPercent - decrement, minPercent);
        }
        if (targetPercent === normalizedPercent) return prevCamera;
        const nextScale = targetPercent / 100;
        if (viewportSize.width === 0 || viewportSize.height === 0) {
          return { ...prevCamera, scale: nextScale };
        }
        const center = {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2
        };
        const anchorWorldX = (center.x - prevCamera.x) / prevCamera.scale;
        const anchorWorldY = (center.y - prevCamera.y) / prevCamera.scale;
        const newX = center.x - anchorWorldX * nextScale;
        const newY = center.y - anchorWorldY * nextScale;
        return {
          x: Number.isFinite(newX) ? newX : prevCamera.x,
          y: Number.isFinite(newY) ? newY : prevCamera.y,
          scale: nextScale
        };
      });
    },
    [viewportSize]
  );

  const handleZoomIn = useCallback(() => {
    adjustZoom('in');
  }, [adjustZoom]);

  const handleZoomOut = useCallback(() => {
    adjustZoom('out');
  }, [adjustZoom]);

  const handleRecordPathsSnapshot = useCallback(() => {
    if (historyGuardRef.current) return;
    setHistory(prev => ({
      past: [...prev.past, paths],
      future: []
    }));
  }, [paths]);

  const applyPathsSnapshot = useCallback((snapshot: CanvasPath[]) => {
    historyGuardRef.current = true;
    setPaths(snapshot);
    setTimeout(() => {
      historyGuardRef.current = false;
    }, 0);
  }, []);

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      const newFuture = [paths, ...prev.future];
      applyPathsSnapshot(previous);
      return { past: newPast, future: newFuture };
    });
  }, [paths, applyPathsSnapshot]);

  const handleRedo = useCallback(() => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      const [next, ...restFuture] = prev.future;
      const newPast = [...prev.past, paths];
      applyPathsSnapshot(next);
      return { past: newPast, future: restFuture };
    });
  }, [paths, applyPathsSnapshot]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      if (event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleRedo, handleUndo]);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const handleDrawColorChange = useCallback((color: string) => {
    setStrokeColor(color);
  }, []);

  const handleRecordColorUsage = useCallback((color: string) => {
    setRecentColors(prev => {
      const next = [color, ...prev.filter(entry => entry !== color)];
      return next.slice(0, 5);
    });
  }, []);


  const buildNoteDocument = useCallback((): NoteDocument => ({
    version: NOTE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    camera,
    paths,
    textNodes,
    strokeColor,
    strokeScale,
    defaultTextScale,
    defaultTextFont
  }), [camera, paths, textNodes, strokeColor, strokeScale, defaultTextScale, defaultTextFont]);

  const sanitizeCamera = useCallback((value: unknown): CameraState => {
    if (!value || typeof value !== 'object') {
      return INITIAL_CAMERA;
    }
    const partial = value as Partial<CameraState>;
    const scale = typeof partial.scale === 'number' && Number.isFinite(partial.scale)
      ? clamp(partial.scale, MIN_ZOOM, MAX_ZOOM)
      : INITIAL_CAMERA.scale;
    return {
      x: typeof partial.x === 'number' && Number.isFinite(partial.x) ? partial.x : INITIAL_CAMERA.x,
      y: typeof partial.y === 'number' && Number.isFinite(partial.y) ? partial.y : INITIAL_CAMERA.y,
      scale
    };
  }, []);

  const applyLoadedNote = useCallback((note: NoteDocument) => {
    const nextPaths = Array.isArray(note.paths) ? (note.paths as CanvasPath[]) : [];
    const nextTextNodes = Array.isArray(note.textNodes) ? (note.textNodes as CanvasTextNode[]) : [];
    setPaths(nextPaths);
    setTextNodes(nextTextNodes);
    setCamera(sanitizeCamera(note.camera));
    setStrokeColor(typeof note.strokeColor === 'string' ? note.strokeColor : '#111827');
    setStrokeScale(typeof note.strokeScale === 'number' && Number.isFinite(note.strokeScale) ? note.strokeScale : 0.5);
    if (Object.hasOwn(note, 'defaultTextScale')) {
      if (note.defaultTextScale === null) {
        setDefaultTextScale(null);
      } else if (typeof note.defaultTextScale === 'number' && Number.isFinite(note.defaultTextScale)) {
        setDefaultTextScale(note.defaultTextScale);
      } else {
        setDefaultTextScale(1);
      }
    } else {
      setDefaultTextScale(1);
    }
    if (typeof note.defaultTextFont === 'string' && note.defaultTextFont.trim().length > 0) {
      setDefaultTextFont(note.defaultTextFont.trim());
    } else {
      setDefaultTextFont('Inter');
    }
    setHistory({ past: [], future: [] });
    setPendingFocusId(null);
  }, [sanitizeCamera, setPaths, setTextNodes, setStrokeColor, setStrokeScale, setDefaultTextScale, setDefaultTextFont, setHistory, setPendingFocusId]);

  const downloadNoteLocally = useCallback((note: NoteDocument, fileName?: string | null) => {
    const resolvedName = ensureNoteFileName(fileName);
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = resolvedName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const openNoteLocally = useCallback(async (): Promise<{ document: NoteDocument | null; name?: string }> => (
    new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ntp,.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve({ document: null });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const parsed = JSON.parse(result) as NoteDocument;
            resolve({ document: parsed, name: file.name });
          } catch (error) {
            window.alert('Could not read that note file.');
            resolve({ document: null });
          }
        };
        reader.onerror = () => {
          window.alert('Could not read that note file.');
          resolve({ document: null });
        };
        reader.readAsText(file);
      };
      input.click();
    })
  ), []);

  const openNoteViaSystemDialog = useCallback(async () => {
    if (!window.noteBridge?.openDocument) {
      const fallback = await openNoteLocally();
      if (fallback.document) {
        applyLoadedNote(fallback.document);
        setActiveFilePath(fallback.name ?? null);
      }
      return;
    }
    try {
      const result = await window.noteBridge.openDocument();
      if (result?.status === 'opened') {
        applyLoadedNote(result.document);
        setActiveFilePath(result.fileName ?? result.path);
      } else if (result?.status === 'error') {
        window.alert(`Could not open note: ${result.message}`);
      }
    } catch (error) {
      window.alert('Could not open note.');
    }
  }, [applyLoadedNote, openNoteLocally]);

  const refreshNoteLibrary = useCallback(async () => {
    if (!window.noteBridge?.listDocuments) return;
    setNoteLibraryLoading(true);
    setNoteLibraryError(null);
    try {
      const result: NoteBridgeListResult = await window.noteBridge.listDocuments();
      if (result?.status === 'ok') {
        setNoteLibraryFiles(result.files ?? []);
      } else if (result?.status === 'error') {
        setNoteLibraryError(result.message ?? 'Could not load notes.');
      }
    } catch (error) {
      setNoteLibraryError('Could not load notes.');
      const message = error instanceof Error ? error.message : '';
      if (message.includes('note:list')) {
        setIsNoteLibraryOpen(false);
        await openNoteViaSystemDialog();
      }
    } finally {
      setNoteLibraryLoading(false);
    }
  }, [openNoteViaSystemDialog]);

  const performSave = useCallback(async (requestedName?: string | null) => {
    const note = buildNoteDocument();
    if (!window.noteBridge?.saveDocument) {
      const fallbackName = ensureNoteFileName(requestedName ?? fileLabel ?? 'note');
      downloadNoteLocally(note, fallbackName);
      setActiveFilePath(fallbackName);
      return;
    }
    const normalizedName = sanitizeNoteName(requestedName ?? fileLabel ?? 'note');
    if (!normalizedName) {
      window.alert('Please provide a valid name for your note.');
      return;
    }
    try {
      const result = await window.noteBridge.saveDocument({
        document: note,
        fileName: normalizedName
      });
      if (result?.status === 'saved') {
        setActiveFilePath(result.fileName ?? normalizedName);
      } else if (result?.status === 'error') {
        window.alert(`Could not save note: ${result.message}`);
      }
    } catch (error) {
      window.alert('Could not save note.');
    }
  }, [buildNoteDocument, downloadNoteLocally, fileLabel]);

  const handleSaveNote = useCallback(() => {
    setSaveDialogError(null);
    setSaveDialogValue(fileLabel ?? 'My note');
    setIsSaveDialogOpen(true);
  }, [fileLabel]);

  const handleOpenNote = useCallback(async () => {
    if (!window.noteBridge?.listDocuments) {
      await openNoteViaSystemDialog();
      return;
    }
    setNoteLibrarySearch('');
    setIsNoteLibraryOpen(true);
  }, [openNoteViaSystemDialog]);

  useEffect(() => {
    if (!isNoteLibraryOpen) return;
    refreshNoteLibrary();
  }, [isNoteLibraryOpen, refreshNoteLibrary]);

  const handleImportNoteFiles = useCallback(async () => {
    if (!window.noteBridge?.importDocuments) return;
    try {
      const result = await window.noteBridge.importDocuments();
      if (result?.status === 'error') {
        window.alert(`Could not import files: ${result.message}`);
      } else if (result?.status === 'imported') {
        const imported = result.files ?? [];
        if (imported.length > 0) {
          await refreshNoteLibrary();
        }
      }
    } catch (error) {
      window.alert('Could not import files.');
    }
  }, [refreshNoteLibrary]);

  const handleSelectNoteFromLibrary = useCallback((file: SavedNoteMetadata) => {
    if (!file.document) {
      window.alert('This file could not be previewed.');
      return;
    }
    applyLoadedNote(file.document);
    setActiveFilePath(file.fileName ?? file.path);
    setIsNoteLibraryOpen(false);
  }, [applyLoadedNote]);

  const handleCreateNewNote = useCallback(() => {
    setPaths([]);
    setTextNodes([]);
    setCamera(INITIAL_CAMERA);
    setStrokeColor('#111827');
    setStrokeScale(0.5);
    setDefaultTextScale(1);
    setDefaultTextFont('Inter');
    setHistory({ past: [], future: [] });
    setPendingFocusId(null);
    setActiveFilePath(null);
    setIsNoteLibraryOpen(false);
  }, []);

  useEffect(() => {
    if (!fileLabel) return;
    if (!window.noteBridge?.saveDocument) return;
    const intervalId = window.setInterval(() => {
      performSave(fileLabel);
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [fileLabel, performSave]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (fileLabel) {
        void performSave(fileLabel);
      } else {
        handleSaveNote();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [fileLabel, handleSaveNote, performSave]);

  const handleSaveDialogConfirm = useCallback(async () => {
    const trimmed = saveDialogValue.trim();
    if (!trimmed) {
      setSaveDialogError('Please enter a valid name.');
      return;
    }
    setIsSaveDialogOpen(false);
    setSaveDialogError(null);
    await performSave(trimmed);
  }, [performSave, saveDialogValue]);

  const handleSaveDialogCancel = useCallback(() => {
    setIsSaveDialogOpen(false);
    setSaveDialogError(null);
  }, []);

  useEffect(() => {
    if (!isSaveDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleSaveDialogCancel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleSaveDialogConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveDialogCancel, handleSaveDialogConfirm, isSaveDialogOpen]);

  return (
    <div className={`app-shell${isNoteLibraryOpen ? ' app-shell--frozen' : ''}`}>
      <NoteLibraryOverlay
        isOpen={isNoteLibraryOpen}
        files={noteLibraryFiles}
        loading={noteLibraryLoading}
        error={noteLibraryError}
        searchValue={noteLibrarySearch}
        onSearchChange={value => setNoteLibrarySearch(value)}
        onClose={() => setIsNoteLibraryOpen(false)}
        onImport={handleImportNoteFiles}
        onSelect={handleSelectNoteFromLibrary}
        onOpenFallback={openNoteViaSystemDialog}
        onCreateNew={handleCreateNewNote}
      />
      <Toolbar
        currentMode={mode}
        onModeChange={setMode}
        drawTool={drawTool}
        onDrawToolChange={setDrawTool}
        drawColor={strokeColor}
        onDrawColorChange={handleDrawColorChange}
        zoom={camera.scale}
        shapeTool={shapeTool}
        onShapeToolChange={setShapeTool}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        recentColors={recentColors}
        textSize={defaultTextScale}
        onTextSizeChange={handleDefaultTextScaleChange}
        textFont={defaultTextFont}
        onTextFontChange={handleDefaultTextFontChange}
        onSaveNote={handleSaveNote}
        onOpenNote={handleOpenNote}
        currentFileLabel={fileLabel}
      />
      {showTextSizeAlert && (
        <div className="text-size-alert" role="alert">
          Set a text size before placing a text box.
        </div>
      )}
      {isSaveDialogOpen && (
        <div className="save-dialog__backdrop" role="presentation">
          <div className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
            <h2 id="save-dialog-title">Save note</h2>
            <p className="save-dialog__description">Choose a name and it will be saved to your NotesTaker folder.</p>
            <label className="save-dialog__label" htmlFor="save-dialog-input">Note name</label>
            <input
              id="save-dialog-input"
              type="text"
              value={saveDialogValue}
              onChange={event => setSaveDialogValue(event.target.value)}
              autoFocus
            />
            {saveDialogError && <div className="save-dialog__error">{saveDialogError}</div>}
            <div className="save-dialog__actions">
              <button type="button" onClick={handleSaveDialogCancel} className="save-dialog__button">Cancel</button>
              <button type="button" onClick={handleSaveDialogConfirm} className="save-dialog__button save-dialog__button--primary">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {mode === 'draw' && drawTool !== 'cursor' && drawTool !== 'text' && drawTool !== 'textbox' && !isNoteLibraryOpen && (
        <StrokeScaleControl
          value={strokeScale}
          onChange={setStrokeScale}
          color={strokeColor}
        />
      )}
      <CanvasViewport
        mode={mode}
        drawTool={drawTool}
        shapeTool={shapeTool}
        drawColor={strokeColor}
        strokeScale={strokeScale}
        camera={camera}
        setCamera={setCamera}
        paths={paths}
        setPaths={setPaths}
        textNodes={textNodes}
        onRequestTextNode={handleCreateTextNode}
        onUpdateTextNode={handleUpdateTextNode}
        onDeleteTextNode={handleDeleteTextNode}
        onMoveTextNode={handleMoveTextNode}
        onResizeTextNode={handleResizeTextNode}
        onUpdateTextNodeStyle={handleUpdateTextNodeStyle}
        onCopyTextNode={handleCopyTextNode}
        onCutTextNode={handleCutTextNode}
        onDuplicateTextNode={handleDuplicateTextNode}
        onReorderTextNode={handleReorderTextNode}
        pendingFocusId={pendingFocusId}
        clearPendingFocus={handleClearPendingFocus}
        onRequestBlankCanvas={handleCreateNewNote}
        onViewportSizeChange={handleViewportSizeChange}
        onBeginPath={handleRecordPathsSnapshot}
        onStrokeColorUsed={handleRecordColorUsage}
      />
    </div>
  );
};

export default App;
