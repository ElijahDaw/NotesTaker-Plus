import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef } from 'react';
import type { NoteDocument, SavedNoteMetadata } from '../types/note';

interface NoteLibraryOverlayProps {
  isOpen: boolean;
  files: SavedNoteMetadata[];
  loading: boolean;
  error: string | null;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onImport: () => void;
  onSelect: (file: SavedNoteMetadata) => void;
  onOpenFallback?: () => void;
  onCreateNew?: () => void;
}

const CANVAS_WIDTH = 240;
const CANVAS_HEIGHT = 150;

const NotePreviewCanvas = ({ document }: { document?: NoteDocument | null }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#cbd5f5';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    if (!document) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('No preview', 12, canvas.height - 12);
      return;
    }
    const points: Array<{ x: number; y: number }> = [];
    for (const path of document.paths ?? []) {
      for (const point of path.points ?? []) {
        points.push(point);
      }
    }
    for (const node of document.textNodes ?? []) {
      points.push({ x: node.x, y: node.y });
      if (node.width && node.height) {
        points.push({ x: node.x + node.width, y: node.y + node.height });
      }
    }
    let minX = 0;
    let minY = 0;
    let maxX = 1;
    let maxY = 1;
    if (points.length > 0) {
      minX = Math.min(...points.map(p => p.x));
      minY = Math.min(...points.map(p => p.y));
      maxX = Math.max(...points.map(p => p.x));
      maxY = Math.max(...points.map(p => p.y));
      if (minX === maxX) maxX = minX + 1;
      if (minY === maxY) maxY = minY + 1;
    }
    const padding = 16;
    const scale = Math.min(
      (canvas.width - padding * 2) / (maxX - minX),
      (canvas.height - padding * 2) / (maxY - minY)
    );
    const project = (point: { x: number; y: number }) => ({
      x: (point.x - minX) * scale + padding,
      y: (point.y - minY) * scale + padding
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of document.paths ?? []) {
      if (!path.points || path.points.length < 2) continue;
      ctx.beginPath();
      path.points.forEach((point, index) => {
        const projected = project(point);
        if (index === 0) {
          ctx.moveTo(projected.x, projected.y);
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      });
      ctx.strokeStyle = path.color || '#111827';
      ctx.globalAlpha = path.opacity ?? 1;
      ctx.lineWidth = Math.max((path.width || 1) * scale * 0.1, 1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const node of document.textNodes ?? []) {
      const width = node.width ?? 120;
      const height = node.height ?? 60;
      const topLeft = project({ x: node.x, y: node.y });
      const size = {
        w: width * scale,
        h: height * scale
      };
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.strokeStyle = node.color || '#0f172a';
      ctx.lineWidth = 1;
      ctx.fillRect(topLeft.x, topLeft.y, size.w, size.h);
      ctx.strokeRect(topLeft.x, topLeft.y, size.w, size.h);
      ctx.fillStyle = node.color || '#0f172a';
      ctx.font = 'bold 10px Inter, sans-serif';
      const text = node.text?.slice(0, 16) || 'Text';
      ctx.fillText(text, topLeft.x + 4, topLeft.y + 14);
    }
  }, [document]);

  return <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="note-library-previewCanvas" />;
};

const NoteLibraryOverlay = ({
  isOpen,
  files,
  loading,
  error,
  searchValue,
  onSearchChange,
  onClose,
  onImport,
  onSelect,
  onOpenFallback,
  onCreateNew
}: NoteLibraryOverlayProps) => {
  const filteredFiles = useMemo(() => {
    if (!searchValue.trim()) return files;
    const normalized = searchValue.trim().toLowerCase();
    return files.filter(file => file.fileName.toLowerCase().includes(normalized));
  }, [files, searchValue]);

  const getDisplayName = (fileName: string) => {
    return fileName.toLowerCase().endsWith('.ntp') ? fileName.slice(0, -4) : fileName;
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="note-library-backdrop" role="dialog" aria-modal="true" aria-label="Note library">
      <div className="note-library-window">
        <header className="note-library-header">
          <div>
            <h2>Open notes</h2>
            <p>Browse all saved note pages in your collection.</p>
          </div>
          <div className="note-library-headerActions">
            {onCreateNew && (
              <button type="button" className="note-library-button note-library-button--primary" onClick={onCreateNew}>
                New note
              </button>
            )}
            <button type="button" className="note-library-button" onClick={onImport}>
              Import files
            </button>
            <button type="button" className="note-library-button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="note-library-searchBar">
          <input
            type="search"
            placeholder="Search notes by name"
            value={searchValue}
            onChange={event => onSearchChange(event.target.value)}
          />
        </div>
        {error && (
          <div className="note-library-error">
            <span>{error}</span>
            {onOpenFallback && (
              <button type="button" className="note-library-secondaryButton" onClick={onOpenFallback}>
                Open via system dialog
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="note-library-empty">Loading your notes…</div>
        ) : filteredFiles.length === 0 ? (
          <div className="note-library-empty">No notes found.</div>
        ) : (
          <div className="note-library-grid">
            {filteredFiles.map(file => (
              <button
                key={file.path}
                type="button"
                className="note-library-card"
                onClick={() => onSelect(file)}
              >
                <NotePreviewCanvas document={file.document ?? null} />
                <div className="note-library-cardMeta">
                  <div className="note-library-cardName">{getDisplayName(file.fileName)}</div>
                  <div className="note-library-cardMetaLine">
                    Updated {new Date(file.updatedAt).toLocaleString()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default NoteLibraryOverlay;
