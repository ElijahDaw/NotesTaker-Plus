import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CanvasViewport, {
  CameraState,
  CanvasMode,
  CanvasPath,
  CanvasImageNode,
  CanvasTextNode,
  DrawTool,
  ImagePlacement,
  MAX_ZOOM,
  MIN_ZOOM,
  ShapeTool,
  TextNodeKind,
  TextNodeRequestOptions,
  ViewportSize,
  WorldPoint
} from './components/CanvasViewport';
import { supabase } from './lib/supabaseClient';
import { fetchSharedDocument, upsertSharedDocument } from './lib/sharedDocuments';
import type { RealtimeChannel, User } from '@supabase/supabase-js';
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
const ENABLE_INSERT_SECTION = false;
const ENABLE_IMAGE_TOOL = false;
const AUTOSAVE_INTERVAL_MS = 10 * 60 * 1000;
const detectDesktopBridge = () => typeof window !== 'undefined' && Boolean(window.noteBridge);

type ShareStatus = 'disabled' | 'syncing' | 'ready' | 'error';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const PROFANITY_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'slut',
  'whore',
  'cunt',
  'dick',
  'pussy',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'asshole',
  'bastard',
  'cock',
  'twat',
  'cum',
  'bollock',
  'wanker',
  'kike',
  'spic'
];

const normalizeUsernameForProfanity = (value: string) => {
  const substitutions: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '!': 'i',
    '3': 'e',
    '@': 'a',
    '4': 'a',
    '$': 's',
    '5': 's',
    '7': 't',
    '8': 'b'
  };
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  let replaced = '';
  for (const char of base) {
    replaced += substitutions[char] ?? char;
  }
  return replaced.replace(/(.)\1+/g, '$1');
};

const containsProfanity = (value: string) => {
  if (!value) return false;
  const normalized = normalizeUsernameForProfanity(value);
  if (!normalized) return false;
  return PROFANITY_WORDS.some(word => normalized.includes(word));
};

const normalizeHandle = (value?: string | null) => {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ShareInviteResponse {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

interface IncomingInvite {
  id: string;
  shareId: string;
  senderName: string;
}

const sanitizeNoteName = (value?: string | null) => {
  if (!value || typeof value !== 'string') {
    return 'note';
  }
  let sanitized = value.trim();
  sanitized = sanitized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/\.+$/, '');
  return sanitized || 'note';
};

const stripSharedSuffix = (value?: string | null) => {
  if (!value || typeof value !== 'string') return value ?? '';
  return value.replace(/\s*-\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.ntp)?$/i, '').trim();
};

const ensureNoteFileName = (value?: string | null) => {
  const sanitized = sanitizeNoteName(value);
  return sanitized.toLowerCase().endsWith('.ntp') ? sanitized : `${sanitized}.ntp`;
};

const mergeById = <T extends { id: string }>(remote: T[], local: T[] = []) => {
  if (!local.length) return [...remote];
  const remoteIds = new Set(remote.map(item => item.id));
  const merged: T[] = [];
  local.forEach(item => {
    if (!remoteIds.has(item.id)) {
      merged.push(item);
    }
  });
  return [...merged, ...remote];
};

interface HistoryState {
  past: CanvasPath[][];
  future: CanvasPath[][];
}

interface PersistSharedOptions {
  noteName?: string;
  removePrevious?: boolean;
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
  const [imageNodes, setImageNodes] = useState<CanvasImageNode[]>([]);
  const [pendingImagePlacement, setPendingImagePlacement] = useState<ImagePlacement | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sharedUpdatedAt, setSharedUpdatedAt] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>('disabled');
  const [sharePresenceCount, setSharePresenceCount] = useState(0);
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [shareInviteValue, setShareInviteValue] = useState('');
  const [shareInviteStatus, setShareInviteStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [shareInviteMessage, setShareInviteMessage] = useState<string | null>(null);
  const [onlineUserMap, setOnlineUserMap] = useState<Record<string, string>>({});
  const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);
  const [inviteProgress, setInviteProgress] = useState(100);
  const [hasDesktopBridge, setHasDesktopBridge] = useState(detectDesktopBridge);
  const textSizeAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGuardRef = useRef(false);
  const textClipboardRef = useRef<CanvasTextNode | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogValue, setSaveDialogValue] = useState('');
  const [saveDialogError, setSaveDialogError] = useState<string | null>(null);
  const shareChannelRef = useRef<RealtimeChannel | null>(null);
  const shareBroadcastTimerRef = useRef<number | null>(null);
  const sharePeerIdRef = useRef<string>(crypto.randomUUID());
  const userChannelRef = useRef<RealtimeChannel | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const applyingRemoteStateRef = useRef(false);
  const pathsRef = useRef<CanvasPath[]>([]);
  const textNodesRef = useRef<CanvasTextNode[]>([]);
  const imageNodesRef = useRef<CanvasImageNode[]>([]);
  const pendingImagePlacementRef = useRef<ImagePlacement | null>(null);
  const sharedUpdatedAtRef = useRef<string | null>(sharedUpdatedAt);
  const inviteTimeoutRef = useRef<number | null>(null);
  const inviteIntervalRef = useRef<number | null>(null);
  const normalizedUsernameRef = useRef<string>('');
  const sharedBaseNameRef = useRef<string | null>(null);
  const fileLabel = useMemo(() => {
    if (!activeFilePath) return null;
    const parts = activeFilePath.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? activeFilePath;
  }, [activeFilePath]);

  useEffect(() => {
    if (!fileLabel) return;
    const cleaned = stripSharedSuffix(fileLabel);
    if (cleaned !== fileLabel) {
      setActiveFilePath(cleaned);
    }
  }, [fileLabel]);
  const canUseShare = Boolean(currentUser && hasDesktopBridge && activeFilePath);
  const shareRestrictionMessage = !hasDesktopBridge
    ? 'Install the NotesTaker desktop app to collaborate.'
    : !currentUser
      ? 'Sign in to enable sharing.'
      : !activeFilePath
        ? 'Save this note before turning on sharing.'
        : null;
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

  const persistSharedDocument = useCallback(async (shareKey: string, note: NoteDocument, options?: PersistSharedOptions) => {
    if (!shareKey) return null;
    if (!window.noteBridge?.saveSharedDocument) return null;
    let preferredName = stripSharedSuffix(options?.noteName ?? sharedBaseNameRef.current ?? fileLabel ?? 'Shared note');
    if (options?.noteName) {
      sharedBaseNameRef.current = preferredName;
    }
    const targetName = ensureNoteFileName(preferredName);
    try {
      const result = await window.noteBridge.saveSharedDocument({
        document: note,
        shareId: shareKey,
        fileName: targetName,
        previousFileName: options?.removePrevious ? activeFilePath ?? null : null
      });
      if (result?.status === 'saved' && (options?.noteName || !sharedBaseNameRef.current)) {
        setActiveFilePath(result.fileName ?? targetName);
      } else if (result?.status === 'error') {
        console.error('Failed to save shared note locally', result.message);
      }
      return result ?? null;
    } catch (error) {
      console.error('Failed to save shared note locally', error);
      return null;
    }
  }, [activeFilePath, fileLabel, setActiveFilePath]);

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
    imageNodesRef.current = imageNodes;
  }, [imageNodes]);
  useEffect(() => {
    pendingImagePlacementRef.current = pendingImagePlacement;
  }, [pendingImagePlacement]);

  useEffect(() => {
    sharedUpdatedAtRef.current = sharedUpdatedAt;
  }, [sharedUpdatedAt]);

  useEffect(() => {
    if (!shareId) {
      sharedBaseNameRef.current = null;
      return;
    }
    if (fileLabel) {
      sharedBaseNameRef.current = stripSharedSuffix(fileLabel);
    }
  }, [fileLabel, shareId]);

  useEffect(() => {
    const normalized =
      normalizeHandle(username ?? currentUser?.email ?? currentUser?.id ?? null) ||
      currentUser?.id ||
      '';
    normalizedUsernameRef.current = normalized;
  }, [currentUser, username]);

  useEffect(() => {
    setTextNodes(nodes => {
      if (!nodes.length) return nodes;
      const pathIds = new Set(paths.map(path => path.id));
      let didRemove = false;
      const filtered = nodes.filter(node => {
        if (node.parentPathId && !pathIds.has(node.parentPathId)) {
          didRemove = true;
          return false;
        }
        return true;
      });
      return didRemove ? filtered : nodes;
    });
  }, [paths]);


  const handleCreateTextNode = useCallback((point: WorldPoint, kind: TextNodeKind, options?: TextNodeRequestOptions) => {
    const requiresDefaultScale = kind === 'textbox' && options?.fontScale === undefined;
    if (requiresDefaultScale && defaultTextScale === null) {
      triggerTextSizeAlert();
      return;
    }
    const id = crypto.randomUUID();
    const nextFontScale =
      options?.fontScale ??
      (kind === 'textbox' ? defaultTextScale ?? 1 : 1);
    const autoFocus = options?.autoFocus ?? true;
    const defaultLocked = kind === 'label';
    setTextNodes(nodes => [
      ...nodes,
      {
        id,
        x: point.x,
        y: point.y,
        text: options?.text ?? '',
        kind,
        fontScale: nextFontScale,
        fontFamily: options?.fontFamily ?? defaultTextFont,
        fontScaleLocked: options?.fontScaleLocked ?? false,
        locked: options?.locked ?? defaultLocked,
        color: options?.color ?? strokeColor,
        width: options?.width,
        height: options?.height,
        parentPathId: options?.parentPathId
      }
    ]);
    if (autoFocus) {
      setPendingFocusId(id);
    }
  }, [defaultTextFont, defaultTextScale, strokeColor, triggerTextSizeAlert]);

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

  const addImageNodeFromSource = useCallback(
    (src: string, naturalWidth: number, naturalHeight: number, placement?: ImagePlacement | null) => {
      const fallbackWidth = 320;
      const fallbackHeight = 240;
      let width = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : fallbackWidth;
      let height = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : fallbackHeight;
      if (!placement) {
        const maxWidth = 640;
        const maxHeight = 480;
        const minWidth = 160;
        const minHeight = 120;
        const scaleDown = Math.min(1, maxWidth / width, maxHeight / height);
        width *= scaleDown;
        height *= scaleDown;
        if (width < minWidth) {
          const adjust = minWidth / width;
          width = minWidth;
          height *= adjust;
        }
        if (height < minHeight) {
          const adjust = minHeight / height;
          height = minHeight;
          width *= adjust;
        }
      } else {
        width = Math.max(placement.width, 16);
        height = Math.max(placement.height, 16);
      }
      let x: number;
      let y: number;
      if (placement) {
        x = placement.x;
        y = placement.y;
      } else {
        const centerX = viewportSize.width / 2;
        const centerY = viewportSize.height / 2;
        const worldX = (centerX - camera.x) / camera.scale;
        const worldY = (centerY - camera.y) / camera.scale;
        x = worldX - width / 2;
        y = worldY - height / 2;
      }
      const nextNode: CanvasImageNode = {
        id: crypto.randomUUID(),
        x,
        y,
        width,
        height,
        src
      };
      setImageNodes(nodes => [...nodes, nextNode]);
    },
    [camera.x, camera.y, camera.scale, setImageNodes, viewportSize.height, viewportSize.width]
  );

  const handleImageFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!ENABLE_IMAGE_TOOL) {
        event.target.value = '';
        return;
      }
      const file = event.target.files?.[0];
      if (!file) {
        event.target.value = '';
        setPendingImagePlacement(null);
        return;
      }
      if (file && file.type && !file.type.startsWith('image/')) {
        window.alert('Please choose an image file.');
        event.target.value = '';
        setPendingImagePlacement(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          window.alert('Could not read that image.');
          setPendingImagePlacement(null);
          return;
        }
        const img = new Image();
        img.onload = () => {
          addImageNodeFromSource(
            result,
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
            pendingImagePlacementRef.current
          );
          setPendingImagePlacement(null);
        };
        img.onerror = () => {
          window.alert('Could not load that image.');
          setPendingImagePlacement(null);
        };
        img.src = result;
      };
      reader.onerror = () => {
        window.alert('Could not load that image.');
        setPendingImagePlacement(null);
      };
      reader.readAsDataURL(file);
      event.target.value = '';
    },
    [addImageNodeFromSource]
  );

  const handleImageDrawComplete = useCallback((rect: ImagePlacement) => {
    if (!ENABLE_IMAGE_TOOL) return;
    setPendingImagePlacement(rect);
    imageInputRef.current?.click();
  }, []);

  const handleImageDrawCancel = useCallback(() => {
    if (!ENABLE_IMAGE_TOOL) return;
    setPendingImagePlacement(null);
  }, []);

  const handleDeleteImageNode = useCallback((id: string) => {
    setImageNodes(nodes => nodes.filter(node => node.id !== id));
  }, []);

  const handleMoveImageNode = useCallback((id: string, x: number, y: number) => {
    setImageNodes(nodes => nodes.map(node => (node.id === id ? { ...node, x, y } : node)));
  }, []);

  const handleResizeImageNode = useCallback((id: string, width: number, height: number) => {
    setImageNodes(nodes =>
      nodes.map(node => (node.id === id ? { ...node, width: Math.max(width, 40), height: Math.max(height, 40) } : node))
    );
  }, []);

  const handleInsertTable = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.alert('Table creation is coming soon.');
  }, []);

  useEffect(() => {
    if (!ENABLE_IMAGE_TOOL && drawTool === 'image') {
      setDrawTool('pen');
    }
  }, [drawTool]);

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

  const handleSaveNote = useCallback(() => {
    setSaveDialogError(null);
    setSaveDialogValue(fileLabel ?? 'My note');
    setIsSaveDialogOpen(true);
  }, [fileLabel]);

  const handleOpenAccountDialog = useCallback(() => {
    setIsAccountDialogOpen(true);
    setAuthError(null);
    setAuthMessage(null);
  }, []);

  const handleShareUnavailable = useCallback(() => {
    if (!hasDesktopBridge) {
      window.alert('Install the NotesTaker desktop app to collaborate on notes.');
      return;
    }
    if (!currentUser) {
      handleOpenAccountDialog();
      return;
    }
    if (!activeFilePath) {
      handleSaveNote();
      window.alert('Save this note before turning on sharing.');
      return;
    }
  }, [activeFilePath, currentUser, handleOpenAccountDialog, handleSaveNote, hasDesktopBridge]);

  const handleCloseAccountDialog = useCallback(() => {
    setIsAccountDialogOpen(false);
    setAuthError(null);
    setAuthMessage(null);
  }, []);

  const handleToggleAuthMode = useCallback(() => {
    setAuthMode(prev => (prev === 'signin' ? 'signup' : 'signin'));
    setAuthError(null);
    setAuthMessage(null);
  }, []);

  const handleContinueAsGuest = useCallback(() => {
    setIsAccountDialogOpen(false);
    setAuthError(null);
    setAuthMessage(null);
    setAuthEmail('');
    setAuthPassword('');
  }, []);

  const handleAuthSubmit = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (authLoading) return;
    const email = authEmail.trim();
    const password = authPassword.trim();
    if (!email || !password) {
      setAuthError('Enter both an email and password.');
      return;
    }
    setAuthError(null);
    setAuthMessage(null);
    setAuthLoading(true);
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthMessage('Check your email to confirm, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setAuthEmail('');
        setAuthPassword('');
        setIsAccountDialogOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not complete that request.';
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  }, [authEmail, authLoading, authMode, authPassword]);

  const handleSaveUsername = useCallback(async () => {
    if (!currentUser || usernameLocked) return;
    const value = usernameInput.trim();
    if (!value) {
      setUsernameError('Enter a username.');
      return;
    }
    if (value.length < 3 || value.length > 24) {
      setUsernameError('Usernames must be between 3 and 24 characters.');
      return;
    }
    if (!/^[a-zA-Z0-9 _.-]+$/.test(value)) {
      setUsernameError('Only letters, numbers, spaces, dots, underscores, and dashes are allowed.');
      return;
    }
    if (containsProfanity(value)) {
      setUsernameError('Please choose a different username.');
      return;
    }
    setUsernameError(null);
    setUsernameSaving(true);
    try {
      const normalized = value.replace(/\s+/g, ' ').trim();
      const { data, error } = await supabase.auth.updateUser({
        data: {
          username: normalized
        }
      });
      if (error) {
        throw error;
      }
      setUsername(normalized);
      setUsernameInput(normalized);
      setUsernameLocked(true);
      if (data?.user) {
        setCurrentUser(data.user);
      } else {
        setCurrentUser(prev => (prev ? { ...prev, user_metadata: { ...prev.user_metadata, username: normalized } } : prev));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save username.';
      setUsernameError(message);
    } finally {
      setUsernameSaving(false);
    }
  }, [currentUser, setCurrentUser, usernameInput, usernameLocked]);

  const handleShareInviteChange = useCallback((value: string) => {
    setShareInviteValue(value);
    setShareInviteStatus('idle');
    setShareInviteMessage(null);
  }, []);

  const buildNoteDocument = useCallback((overrides?: Partial<NoteDocument>): NoteDocument => ({
    version: NOTE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    camera,
    paths,
    textNodes,
    imageNodes,
    strokeColor,
    strokeScale,
    defaultTextScale,
    defaultTextFont,
    shareId,
    sharedUpdatedAt,
    ...overrides
  }), [camera, paths, textNodes, imageNodes, strokeColor, strokeScale, defaultTextScale, defaultTextFont, shareId, sharedUpdatedAt]);

  const buildNoteDocumentRef = useRef(buildNoteDocument);
  useEffect(() => {
    buildNoteDocumentRef.current = buildNoteDocument;
  }, [buildNoteDocument]);

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

interface ApplyNoteOptions {
  preserveView?: boolean;
  mergeLocal?: boolean;
}

  const applyLoadedNote = useCallback((note: NoteDocument, options?: ApplyNoteOptions) => {
    let nextPaths = Array.isArray(note.paths) ? (note.paths as CanvasPath[]) : [];
    let nextTextNodes = Array.isArray(note.textNodes) ? (note.textNodes as CanvasTextNode[]) : [];
    let nextImageNodes = Array.isArray(note.imageNodes) ? (note.imageNodes as CanvasImageNode[]) : [];
    if (options?.mergeLocal) {
      nextPaths = mergeById(nextPaths, pathsRef.current ?? []);
      nextTextNodes = mergeById(nextTextNodes, textNodesRef.current ?? []);
      nextImageNodes = mergeById(nextImageNodes, imageNodesRef.current ?? []);
    }
    setPaths(nextPaths);
    setTextNodes(nextTextNodes);
    setImageNodes(nextImageNodes);
    if (!options?.preserveView) {
      setCamera(sanitizeCamera(note.camera));
    }
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
    const nextShareId = note.shareId ?? null;
    setShareId(nextShareId);
    setSharedUpdatedAt(note.sharedUpdatedAt ?? null);
    setShareStatus(nextShareId ? 'syncing' : 'disabled');
    setSharePresenceCount(0);
    if (!options?.preserveView) {
      setHistory({ past: [], future: [] });
      setPendingFocusId(null);
    }
  }, [sanitizeCamera, setPaths, setTextNodes, setImageNodes, setStrokeColor, setStrokeScale, setDefaultTextScale, setDefaultTextFont, setHistory, setPendingFocusId]);

  const applyLoadedNoteRef = useRef<((note: NoteDocument, options?: ApplyNoteOptions) => void) | null>(applyLoadedNote);
  useEffect(() => {
    applyLoadedNoteRef.current = applyLoadedNote;
  }, [applyLoadedNote]);

  useEffect(() => {
    if (!shareId) {
      setShareStatus('disabled');
      setSharePresenceCount(0);
      return;
    }
    let cancelled = false;
    const syncFromCloud = async () => {
      try {
        const remote = await fetchSharedDocument(shareId);
        if (cancelled || !remote?.payload) return;
        const remoteUpdatedAt = remote.payload.sharedUpdatedAt ?? remote.updated_at;
        const localUpdatedAt = sharedUpdatedAtRef.current ?? '';
        if (!localUpdatedAt || (remoteUpdatedAt && remoteUpdatedAt > localUpdatedAt)) {
          applyingRemoteStateRef.current = true;
          applyLoadedNoteRef.current?.(remote.payload, { preserveView: true, mergeLocal: true });
          setSharedUpdatedAt(remoteUpdatedAt ?? new Date().toISOString());
          if (hasDesktopBridge) {
            const shareKey = remote.payload.shareId ?? shareId;
            if (shareKey) {
              void persistSharedDocument(shareKey, remote.payload);
            }
          }
        }
      } catch (error) {
        console.error('Failed to sync shared document', error);
        setShareStatus('error');
      }
    };
    syncFromCloud();
    return () => {
      cancelled = true;
    };
  }, [hasDesktopBridge, persistSharedDocument, shareId]);

  useEffect(() => {
    if (!shareId) {
      if (shareChannelRef.current) {
        void supabase.removeChannel(shareChannelRef.current);
        shareChannelRef.current = null;
      }
      setShareStatus('disabled');
      setSharePresenceCount(0);
      return;
    }
    setShareStatus('syncing');
    const peerId = sharePeerIdRef.current;
    const channel = supabase.channel(`doc-${shareId}`, {
      config: {
        broadcast: { ack: true },
        presence: { key: peerId }
      }
    });
    shareChannelRef.current = channel;

    const updatePresence = () => {
      const state = channel.presenceState();
      let count = 0;
      Object.values(state).forEach(entries => {
        if (Array.isArray(entries)) {
          count += entries.length;
        }
      });
      setSharePresenceCount(count);
    };

    channel.on('presence', { event: 'sync' }, updatePresence);
    channel.on('presence', { event: 'join' }, updatePresence);
    channel.on('presence', { event: 'leave' }, updatePresence);

    channel.on('broadcast', { event: 'sync-request' }, ({ payload }) => {
      if (!payload || payload.peerId === peerId) return;
      const snapshot = buildNoteDocumentRef.current?.({
        shareId,
        sharedUpdatedAt: sharedUpdatedAtRef.current ?? new Date().toISOString()
      });
      if (!snapshot) return;
      void channel.send({
        type: 'broadcast',
        event: 'state-update',
        payload: {
          peerId,
          document: snapshot
        }
      });
    });

    channel.on('broadcast', { event: 'state-update' }, ({ payload }) => {
      if (!payload || payload.peerId === peerId) return;
      if (!payload.document) return;
      const incomingTimestamp = payload.document.sharedUpdatedAt ?? payload.document.exportedAt ?? new Date().toISOString();
      const localTimestamp = sharedUpdatedAtRef.current;
      if (localTimestamp && incomingTimestamp <= localTimestamp) {
        return;
      }
      applyingRemoteStateRef.current = true;
      applyLoadedNoteRef.current?.(payload.document as NoteDocument, { preserveView: true, mergeLocal: true });
      setSharedUpdatedAt(incomingTimestamp);
      if (hasDesktopBridge) {
        const shareKey = payload.document.shareId ?? shareId;
        if (shareKey) {
          void persistSharedDocument(shareKey, payload.document as NoteDocument);
        }
      }
    });

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        setShareStatus('ready');
        channel.track({ connectedAt: new Date().toISOString() });
        updatePresence();
        void channel.send({ type: 'broadcast', event: 'sync-request', payload: { peerId } });
      }
    });

    return () => {
      void supabase.removeChannel(channel);
      if (shareChannelRef.current === channel) {
        shareChannelRef.current = null;
      }
      setSharePresenceCount(0);
    };
  }, [hasDesktopBridge, persistSharedDocument, shareId]);

  useEffect(() => {
    if (!shareId) return;
    if (applyingRemoteStateRef.current) {
      applyingRemoteStateRef.current = false;
      return;
    }
    if (shareBroadcastTimerRef.current) {
      clearTimeout(shareBroadcastTimerRef.current);
    }
    shareBroadcastTimerRef.current = window.setTimeout(() => {
      const timestamp = new Date().toISOString();
      const snapshot = buildNoteDocument({ shareId, sharedUpdatedAt: timestamp });
      setSharedUpdatedAt(timestamp);
      void (async () => {
        await upsertSharedDocument(shareId, snapshot);
        if (hasDesktopBridge) {
          await persistSharedDocument(shareId, snapshot);
        }
      })();
      const channel = shareChannelRef.current;
      if (channel) {
        const payload = {
          peerId: sharePeerIdRef.current,
          document: snapshot
        };
        if (channel.state === 'joined') {
          void channel.send({
            type: 'broadcast',
            event: 'state-update',
            payload
          });
        } else {
          void channel.httpSend('state-update', payload).catch(error => {
            console.error('Failed to send realtime update via REST fallback', error);
          });
        }
      }
    }, 500);
    return () => {
      if (shareBroadcastTimerRef.current) {
        clearTimeout(shareBroadcastTimerRef.current);
        shareBroadcastTimerRef.current = null;
      }
    };
  }, [buildNoteDocument, hasDesktopBridge, persistSharedDocument, shareId]);

  useEffect(() => {
    setHasDesktopBridge(detectDesktopBridge);
  }, []);

  const handleEnableShare = useCallback(async () => {
    if (!hasDesktopBridge) {
      throw new Error('Install the NotesTaker desktop app to collaborate.');
    }
    if (!currentUser) {
      handleOpenAccountDialog();
      throw new Error('Sign in to enable sharing.');
    }
    if (!activeFilePath) {
      if (window.noteBridge?.saveDocument) {
        handleSaveNote();
      }
      throw new Error('Save this note before turning on sharing.');
    }
    if (shareId) return shareId;
    const newShareId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const snapshot = buildNoteDocument({ shareId: newShareId, sharedUpdatedAt: timestamp });
    setShareId(newShareId);
    setSharedUpdatedAt(timestamp);
    setShareStatus('syncing');
    try {
      await upsertSharedDocument(newShareId, snapshot);
      if (window.noteBridge?.saveSharedDocument) {
        await persistSharedDocument(newShareId, snapshot, { noteName: fileLabel ?? 'Shared note', removePrevious: true });
      }
      setShareStatus('ready');
      return newShareId;
    } catch (error) {
      console.error('Failed to enable sharing', error);
      setShareStatus('error');
      setShareId(null);
      setSharedUpdatedAt(null);
      throw error;
    }
  }, [activeFilePath, buildNoteDocument, currentUser, fileLabel, handleOpenAccountDialog, handleSaveNote, hasDesktopBridge, persistSharedDocument, shareId]);

  const joinSharedDocument = useCallback(async (targetShareId: string): Promise<boolean> => {
    if (!targetShareId) return false;
    if (!hasDesktopBridge) {
      window.alert('Install the NotesTaker desktop app to join shared notes.');
      return false;
    }
    setShareStatus('syncing');
    try {
      const remote = await fetchSharedDocument(targetShareId);
      if (!remote?.payload) {
        setShareStatus('error');
        return false;
      }
      const updatedAt = remote.payload.sharedUpdatedAt ?? remote.updated_at ?? new Date().toISOString();
      applyLoadedNote({ ...remote.payload, shareId: targetShareId, sharedUpdatedAt: updatedAt });
      setShareId(targetShareId);
      setSharedUpdatedAt(updatedAt);
      if (window.noteBridge?.saveSharedDocument) {
        await persistSharedDocument(targetShareId, { ...remote.payload, shareId: targetShareId, sharedUpdatedAt: updatedAt }, { noteName: 'Shared note' });
      }
      setShareStatus('ready');
      return true;
    } catch (error) {
      console.error('Failed to join shared document', error);
      setShareStatus('error');
      return false;
    }
  }, [applyLoadedNote, hasDesktopBridge, persistSharedDocument]);

  const clearInviteTimers = useCallback(() => {
    if (inviteTimeoutRef.current) {
      window.clearTimeout(inviteTimeoutRef.current);
      inviteTimeoutRef.current = null;
    }
    if (inviteIntervalRef.current) {
      window.clearInterval(inviteIntervalRef.current);
      inviteIntervalRef.current = null;
    }
  }, []);

  const showIncomingInvite = useCallback((payload: { shareId: string; senderName: string }) => {
    if (!payload.shareId) return;
    clearInviteTimers();
    const invite: IncomingInvite = {
      id: crypto.randomUUID(),
      shareId: payload.shareId,
      senderName: payload.senderName
    };
    setIncomingInvite(invite);
    setInviteProgress(100);
    const startedAt = Date.now();
    inviteIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 100 - (elapsed / 10000) * 100);
      setInviteProgress(remaining);
      if (elapsed >= 10000) {
        setIncomingInvite(current => (current?.id === invite.id ? null : current));
        setInviteProgress(100);
        clearInviteTimers();
      }
    }, 100);
    inviteTimeoutRef.current = window.setTimeout(() => {
      setIncomingInvite(current => (current?.id === invite.id ? null : current));
      setInviteProgress(100);
      clearInviteTimers();
    }, 10000);
  }, [clearInviteTimers]);

  const handleDismissInvite = useCallback(() => {
    clearInviteTimers();
    setIncomingInvite(null);
    setInviteProgress(100);
  }, [clearInviteTimers]);

  const handleAcceptInvite = useCallback(async () => {
    if (!incomingInvite) return;
    if (!hasDesktopBridge) {
      window.alert('Install the NotesTaker desktop app to join shared notes.');
      return;
    }
    if (!currentUser) {
      handleOpenAccountDialog();
      return;
    }
    const success = await joinSharedDocument(incomingInvite.shareId);
    if (success) {
      handleDismissInvite();
    }
  }, [currentUser, handleDismissInvite, handleOpenAccountDialog, hasDesktopBridge, incomingInvite, joinSharedDocument]);

  const handleDeclineInvite = useCallback(() => {
    handleDismissInvite();
  }, [handleDismissInvite]);

  useEffect(() => () => {
    clearInviteTimers();
  }, [clearInviteTimers]);

  useEffect(() => {
    if (!currentUser) {
      setOnlineUserMap({});
      if (userChannelRef.current) {
        void supabase.removeChannel(userChannelRef.current);
        userChannelRef.current = null;
      }
      return;
    }
    const presenceKey = `${currentUser.id}:${crypto.randomUUID()}`;
    const resolvedDisplayName = username ?? currentUser.email ?? 'NotesTaker user';
    const normalizedSelf = normalizeHandle(username ?? currentUser.email ?? currentUser.id ?? presenceKey) || presenceKey;
    const channel = supabase.channel('user-network', {
      config: {
        broadcast: {
          ack: false,
          self: false
        },
        presence: {
          key: presenceKey
        }
      }
    });
    userChannelRef.current = channel;

    const updateOnlinePresence = () => {
      const state = channel.presenceState<{ username?: string; displayName?: string }>();
      const next: Record<string, string> = {};
      Object.values(state).forEach(entries => {
        entries?.forEach(entry => {
          const handle = normalizeHandle(entry?.username ?? '');
          if (!handle) return;
          next[handle] = entry?.displayName ?? handle;
        });
      });
      setOnlineUserMap(next);
    };

    channel.on('presence', { event: 'sync' }, updateOnlinePresence);
    channel.on('presence', { event: 'join' }, updateOnlinePresence);
    channel.on('presence', { event: 'leave' }, updateOnlinePresence);

    channel.on('broadcast', { event: 'direct-invite' }, ({ payload }) => {
      if (!payload?.recipient || !payload?.shareId) {
        return;
      }
      const normalizedRecipient = normalizeHandle(payload.recipient);
      if (!normalizedRecipient || normalizedRecipient !== normalizedSelf) {
        return;
      }
      showIncomingInvite({
        shareId: payload.shareId,
        senderName: payload.senderName ?? 'NotesTaker user'
      });
    });

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        void channel.track({
          username: normalizedSelf,
          displayName: resolvedDisplayName
        });
        updateOnlinePresence();
      }
    });

    return () => {
      if (userChannelRef.current === channel) {
        userChannelRef.current = null;
      }
      setOnlineUserMap({});
      void supabase.removeChannel(channel);
    };
  }, [currentUser, showIncomingInvite, username]);

  const handleSendShareInvite = useCallback(async () => {
    if (!hasDesktopBridge) {
      setShareInviteStatus('error');
      setShareInviteMessage('Install the NotesTaker desktop app to invite collaborators.');
      return;
    }
    if (!currentUser) {
      handleOpenAccountDialog();
      return;
    }
    let currentShareId = shareId;
    if (!currentShareId) {
      try {
        const enabled = await handleEnableShare();
        if (typeof enabled === 'string') {
          currentShareId = enabled;
        }
      } catch (error) {
        setShareInviteStatus('error');
        setShareInviteMessage('Sign in to enable sharing before inviting others.');
        return;
      }
    }
    if (!currentShareId) {
      setShareInviteStatus('error');
      setShareInviteMessage('Turn on sharing before inviting collaborators.');
      return;
    }
    const trimmed = shareInviteValue.trim();
    if (!trimmed) {
      setShareInviteStatus('error');
      setShareInviteMessage('Enter a valid username or email.');
      return;
    }
    const senderLabel = username ?? currentUser.email ?? 'NotesTaker user';
    const isEmailInvite = trimmed.includes('@');
    if (isEmailInvite) {
      if (!EMAIL_PATTERN.test(trimmed)) {
        setShareInviteStatus('error');
        setShareInviteMessage('Enter a valid email address.');
        return;
      }
      setShareInviteStatus('sending');
      setShareInviteMessage(null);
      try {
        const { data, error } = await supabase.functions.invoke<ShareInviteResponse>('share-invite', {
          body: {
            shareId: currentShareId,
            recipient: trimmed,
            recipientType: 'email',
            senderName: senderLabel
          }
        });
        if (error) {
          throw new Error(error.message ?? 'Unable to send email invite right now.');
        }
        if (!data?.success) {
          if (data?.reason === 'missing_email_config') {
            throw new Error('Email sending is not configured yet. Add Mailjet credentials in Supabase.');
          }
          if (data?.reason === 'recipient_not_found') {
            throw new Error('No NotesTaker account is registered with that email.');
          }
          throw new Error(data?.error ?? 'Unable to send email invite right now.');
        }
        setShareInviteStatus('success');
        setShareInviteMessage('Email invite sent! Check your inbox.');
        setShareInviteValue('');
      } catch (error) {
        console.error('Failed to send email invite', error);
        setShareInviteStatus('error');
        setShareInviteMessage(
          error instanceof Error ? error.message : 'Unable to send email invite right now.'
        );
      }
      return;
    }
    const normalizedRecipient = normalizeHandle(trimmed);
    if (!normalizedRecipient) {
      setShareInviteStatus('error');
      setShareInviteMessage('That username is not valid.');
      return;
    }
    const isRecipientOnline = Boolean(onlineUserMap[normalizedRecipient]);
    if (!isRecipientOnline) {
      setShareInviteStatus('error');
      setShareInviteMessage('No account with that username is currently available to invite.');
      return;
    }
    setShareInviteStatus('sending');
    setShareInviteMessage(null);
    if (userChannelRef.current) {
      void userChannelRef.current.send({
        type: 'broadcast',
        event: 'direct-invite',
        payload: {
          shareId: currentShareId,
          recipient: normalizedRecipient,
          senderName: senderLabel
        }
      });
    }
    setShareInviteStatus('success');
    setShareInviteMessage('Invite sent! They will see it when they open NotesTaker.');
    setShareInviteValue('');
  }, [currentUser, handleEnableShare, handleOpenAccountDialog, hasDesktopBridge, onlineUserMap, shareId, shareInviteValue, username]);

  const handleDisableShare = useCallback(() => {
    handleDismissInvite();
    setShareId(null);
    setSharedUpdatedAt(null);
    setSharePresenceCount(0);
    setShareStatus('disabled');
    setShareInviteStatus('idle');
    setShareInviteMessage(null);
    if (shareChannelRef.current) {
      void supabase.removeChannel(shareChannelRef.current);
      shareChannelRef.current = null;
    }
    sharedBaseNameRef.current = null;
  }, [handleDismissInvite]);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Failed to sign out', error);
    } finally {
      handleDisableShare();
    }
  }, [handleDisableShare]);

  useEffect(() => {
    let isMounted = true;
    const hydrateSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;
        setCurrentUser(data?.session?.user ?? null);
      } catch (error) {
        console.error('Failed to hydrate session', error);
      }
    };
    hydrateSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      if (!session?.user) {
        handleDisableShare();
      }
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [handleDisableShare]);

  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousId = lastUserIdRef.current;
    const nextId = currentUser?.id ?? null;
    if (!previousId && nextId && isAccountDialogOpen) {
      setIsAccountDialogOpen(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthError(null);
      setAuthMessage(null);
    }
    lastUserIdRef.current = nextId;
  }, [currentUser, isAccountDialogOpen]);

  useEffect(() => {
    if (!currentUser) {
      setUsername(null);
      setUsernameInput('');
      setUsernameError(null);
      setUsernameLocked(false);
      return;
    }
    const metadataValue = typeof currentUser.user_metadata?.username === 'string'
      ? currentUser.user_metadata.username.trim()
      : '';
    if (metadataValue) {
      setUsername(metadataValue);
      setUsernameInput(metadataValue);
      setUsernameLocked(true);
    } else {
      setUsername(null);
      setUsernameInput('');
      setUsernameLocked(false);
    }
    setUsernameError(null);
  }, [currentUser]);

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
        const files = (result.files ?? []).map(file => ({
          ...file,
          fileName: file.fileName ? stripSharedSuffix(file.fileName) : file.fileName
        }));
        setNoteLibraryFiles(files);
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
    const normalizedName = sanitizeNoteName(stripSharedSuffix(requestedName ?? fileLabel ?? 'note'));
    if (!normalizedName) {
      window.alert('Please provide a valid name for your note.');
      return;
    }
    const targetName = ensureNoteFileName(normalizedName);
    if (shareId) {
      const result = await persistSharedDocument(shareId, note, { noteName: targetName });
      if (result?.status === 'error') {
        window.alert(`Could not save note: ${result.message}`);
      } else if (!result) {
        window.alert('Could not save note.');
      }
      return;
    }
    if (!window.noteBridge?.saveDocument) {
      downloadNoteLocally(note, targetName);
      setActiveFilePath(targetName);
      return;
    }
    try {
      const result = await window.noteBridge.saveDocument({
        document: note,
        fileName: targetName
      });
      if (result?.status === 'saved') {
        setActiveFilePath(result.fileName ?? targetName);
      } else if (result?.status === 'error') {
        window.alert(`Could not save note: ${result.message}`);
      }
    } catch (error) {
      window.alert('Could not save note.');
    }
  }, [buildNoteDocument, downloadNoteLocally, fileLabel, persistSharedDocument, shareId]);

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
    setImageNodes([]);
    setPendingImagePlacement(null);
    setCamera(INITIAL_CAMERA);
    setStrokeColor('#111827');
    setStrokeScale(0.5);
    setDefaultTextScale(1);
    setDefaultTextFont('Inter');
    setHistory({ past: [], future: [] });
    setPendingFocusId(null);
    setActiveFilePath(null);
    setIsNoteLibraryOpen(false);
    handleDisableShare();
  }, [handleDisableShare]);

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

  useEffect(() => {
    if (!isAccountDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseAccountDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseAccountDialog, isAccountDialogOpen]);

  const inviteToast = useMemo(() => {
    if (!incomingInvite || typeof document === 'undefined') return null;
    return createPortal(
      <div className="invite-toast" role="alert" aria-live="assertive">
        <p className="invite-toast__message">
          <strong>{incomingInvite.senderName}</strong> has invited you to a note page.
        </p>
        <div className="invite-toast__actions">
          <button type="button" className="invite-toast__button" onClick={handleDeclineInvite}>
            Decline
          </button>
          <button
            type="button"
            className="invite-toast__button invite-toast__button--primary"
            onClick={handleAcceptInvite}
          >
            Accept invite
          </button>
        </div>
        <div className="invite-toast__progress" aria-hidden="true">
          <div className="invite-toast__progress-bar" style={{ width: `${inviteProgress}%` }} />
        </div>
      </div>,
      document.body
    );
  }, [handleAcceptInvite, handleDeclineInvite, incomingInvite, inviteProgress]);

  return (
    <>
      {inviteToast}
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
        onInsertTable={handleInsertTable}
        enableInsertSection={ENABLE_INSERT_SECTION}
        enableImageTool={ENABLE_IMAGE_TOOL}
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
      {isAccountDialogOpen && (
        <div className="account-dialog__backdrop" role="presentation">
          <div
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <button type="button" className="account-dialog__close" onClick={handleCloseAccountDialog}>
              Close
            </button>
            {currentUser ? (
              <div className="account-dialog__content">
                <h2 id="account-dialog-title">You&rsquo;re signed in</h2>
                <p className="account-dialog__description">
                  {currentUser.email ?? currentUser.id}
                </p>
                <div className="account-username">
                  <label htmlFor="account-username">Username</label>
                  {usernameLocked ? (
                    <>
                      <div className="account-dialog__locked-username">{username}</div>
                      <p className="account-dialog__hint">
                        Usernames cannot be changed once set.
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        id="account-username"
                        type="text"
                        value={usernameInput}
                        onChange={event => {
                          setUsernameInput(event.target.value);
                          setUsernameError(null);
                        }}
                        placeholder="Pick a public display name"
                        maxLength={32}
                      />
                      <p className="account-dialog__hint">
                        Usernames help collaborators recognize you. Keep it clean and unique.
                      </p>
                    </>
                  )}
                  {usernameError && <div className="account-dialog__error">{usernameError}</div>}
                  {!usernameLocked && (
                    <div className="account-username__actions">
                      <button
                        type="button"
                        className="account-dialog__button"
                        onClick={handleSaveUsername}
                        disabled={usernameSaving}
                      >
                        {usernameSaving ? 'Saving…' : 'Save username'}
                      </button>
                      {username && <span className="account-dialog__current">Current: {username}</span>}
                    </div>
                  )}
                </div>
                <button type="button" className="account-dialog__button account-dialog__button--secondary" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <form className="account-form" onSubmit={event => handleAuthSubmit(event)}>
                <h2 id="account-dialog-title">
                  {authMode === 'signup' ? 'Create an account' : 'Welcome back'}
                </h2>
                <p className="account-dialog__description">
                  Use your email and a password to {authMode === 'signup' ? 'get started' : 'sign in'}.
                </p>
                <label htmlFor="account-email">Email</label>
                <input
                  id="account-email"
                  type="email"
                  value={authEmail}
                  onChange={event => setAuthEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
                <label htmlFor="account-password">Password</label>
                <input
                  id="account-password"
                  type="password"
                  value={authPassword}
                  onChange={event => setAuthPassword(event.target.value)}
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={6}
                  required
                />
                {authError && <div className="account-dialog__error">{authError}</div>}
                {authMessage && <div className="account-dialog__message">{authMessage}</div>}
                <button type="submit" className="account-dialog__button" disabled={authLoading}>
                  {authLoading
                    ? 'Working...'
                    : authMode === 'signup'
                      ? 'Create account'
                      : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="account-dialog__toggle"
                  onClick={handleToggleAuthMode}
                  disabled={authLoading}
                >
                  {authMode === 'signup'
                    ? 'Already have an account? Sign in'
                    : 'Need an account? Sign up'}
                </button>
                <button
                  type="button"
                  className="account-dialog__guest"
                  onClick={handleContinueAsGuest}
                >
                  Continue as guest (sharing disabled)
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      {mode === 'draw' && drawTool !== 'cursor' && drawTool !== 'text' && drawTool !== 'textbox' && drawTool !== 'image' && !isNoteLibraryOpen && (
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
        imageNodes={imageNodes}
        onRequestTextNode={handleCreateTextNode}
        onUpdateTextNode={handleUpdateTextNode}
        onDeleteTextNode={handleDeleteTextNode}
        onMoveTextNode={handleMoveTextNode}
        onResizeTextNode={handleResizeTextNode}
        onUpdateTextNodeStyle={handleUpdateTextNodeStyle}
        onDeleteImageNode={handleDeleteImageNode}
        onMoveImageNode={handleMoveImageNode}
        onResizeImageNode={handleResizeImageNode}
        onImageDrawComplete={handleImageDrawComplete}
        onImageDrawCancel={handleImageDrawCancel}
        imageToolEnabled={ENABLE_IMAGE_TOOL}
        onCopyTextNode={handleCopyTextNode}
        onCutTextNode={handleCutTextNode}
        onDuplicateTextNode={handleDuplicateTextNode}
        onReorderTextNode={handleReorderTextNode}
        pendingFocusId={pendingFocusId}
        clearPendingFocus={handleClearPendingFocus}
        shareId={shareId}
        shareStatus={shareStatus}
        sharePresenceCount={sharePresenceCount}
        accountEmail={currentUser?.email ?? null}
        username={username}
        canUseShare={canUseShare}
        shareRestrictionMessage={shareRestrictionMessage}
        onOpenAccountPanel={handleOpenAccountDialog}
        onShareUnavailable={handleShareUnavailable}
        shareInviteValue={shareInviteValue}
        shareInviteStatus={shareInviteStatus}
        shareInviteMessage={shareInviteMessage}
        onShareInviteChange={handleShareInviteChange}
        onSendShareInvite={handleSendShareInvite}
        onViewportSizeChange={handleViewportSizeChange}
        onBeginPath={handleRecordPathsSnapshot}
        onStrokeColorUsed={handleRecordColorUsage}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleImageFileChange}
      />
    </div>
    </>
  );
};

export default App;
