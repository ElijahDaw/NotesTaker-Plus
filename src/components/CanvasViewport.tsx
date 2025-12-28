import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import { FONT_PRESETS, TEXT_SIZE_PRESETS } from '../constants/textOptions';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, FormEvent } from 'react';
import peopleIcon from '../../icons to use/people_16570539.png';

export type CanvasMode = 'pan' | 'draw';
export type DrawTool = 'cursor' | 'pen' | 'pencil' | 'highlighter' | 'eraser' | 'text' | 'textbox' | 'image';
export type TextNodeKind = 'sticky' | 'textbox' | 'label';
export type ShapeTool =
  | 'freeform'
  | 'line'
  | 'curve'
  | 'arrow'
  | 'rectangle'
  | 'rounded-rectangle'
  | 'ellipse'
  | 'triangle'
  | 'right-triangle'
  | 'diamond'
  | 'hexagon'
  | 'star'
  | 'econ-graph'
  | 'math-graph';

const SHAPE_LABELS: Record<ShapeTool, string> = {
  freeform: 'Freeform',
  line: 'Line',
  curve: 'Curve',
  arrow: 'Arrow',
  rectangle: 'Rectangle',
  'rounded-rectangle': 'Rounded Rectangle',
  ellipse: 'Circle',
  triangle: 'Triangle',
  'right-triangle': 'Right Triangle',
  diamond: 'Diamond',
  hexagon: 'Hexagon',
  star: 'Star',
  'econ-graph': 'Economics Graph',
  'math-graph': 'Math Graph'
};
const OPEN_SHAPES: ShapeTool[] = ['line', 'arrow', 'curve', 'econ-graph', 'math-graph'];

type SelectionHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

type PathKind = 'freehand' | 'curve';

type CurveHandleKind = 'anchor' | 'handleIn' | 'handleOut';

interface CurveHandleDescriptor {
  kind: CurveHandleKind;
  nodeIndex: number;
}

interface CurveNode {
  anchor: WorldPoint;
  handleIn?: WorldPoint | null;
  handleOut?: WorldPoint | null;
}

interface CurveShape {
  nodes: CurveNode[];
}

interface CanvasMask {
  id: string;
  points: WorldPoint[];
  width: number;
}

export interface CanvasPath {
  id: string;
  color: string;
  width: number;
  opacity?: number;
  points: WorldPoint[];
  startCap?: CanvasLineCap;
  endCap?: CanvasLineCap;
  eraserMasks?: CanvasMask[];
  isClosed?: boolean;
  pathKind?: PathKind;
  curve?: CurveShape;
  shapeType?: ShapeTool;
}

export interface CanvasTextNode {
  id: string;
  x: number;
  y: number;
  text: string;
  kind: TextNodeKind;
  width?: number;
  height?: number;
  fontScale?: number;
  fontScaleLocked?: boolean;
  fontFamily?: string;
  locked?: boolean;
  color?: string;
  parentPathId?: string;
}

export interface CanvasImageNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  locked?: boolean;
}

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextNodeRequestOptions {
  text?: string;
  fontScale?: number;
  fontScaleLocked?: boolean;
  fontFamily?: string;
  locked?: boolean;
  color?: string;
  width?: number;
  height?: number;
  autoFocus?: boolean;
  parentPathId?: string;
}

interface CanvasViewportProps {
  mode: CanvasMode;
  drawTool: DrawTool;
  shapeTool: ShapeTool;
  drawColor: string;
  strokeScale: number;
  camera: CameraState;
  setCamera: (value: CameraState | ((prev: CameraState) => CameraState)) => void;
  paths: CanvasPath[];
  setPaths: (value: CanvasPath[] | ((prev: CanvasPath[]) => CanvasPath[])) => void;
  textNodes: CanvasTextNode[];
  imageNodes: CanvasImageNode[];
  onRequestTextNode: (point: WorldPoint, kind: TextNodeKind, options?: TextNodeRequestOptions) => void;
  onUpdateTextNode: (id: string, text: string) => void;
  onDeleteTextNode: (id: string) => void;
  onMoveTextNode: (id: string, x: number, y: number) => void;
  onResizeTextNode: (id: string, width: number, height: number, fontScale?: number, fontScaleLocked?: boolean) => void;
  onUpdateTextNodeStyle: (id: string, updates: Partial<Pick<CanvasTextNode, 'fontScale' | 'fontFamily' | 'fontScaleLocked' | 'locked' | 'width' | 'height' | 'color'>>) => void;
  onDeleteImageNode: (id: string) => void;
  onMoveImageNode: (id: string, x: number, y: number) => void;
  onResizeImageNode: (id: string, width: number, height: number) => void;
  onImageDrawComplete: (rect: ImagePlacement) => void;
  onImageDrawCancel?: () => void;
  imageToolEnabled?: boolean;
  onCopyTextNode: (id: string) => void;
  onCutTextNode: (id: string) => void;
  onDuplicateTextNode: (id: string) => void;
  onReorderTextNode: (id: string, direction: 'forward' | 'backward' | 'front' | 'back') => void;
  pendingFocusId: string | null;
  clearPendingFocus: () => void;
  shareId: string | null;
  shareStatus: 'disabled' | 'syncing' | 'ready' | 'error';
  sharePresenceCount: number;
  accountEmail?: string | null;
  username?: string | null;
  canUseShare: boolean;
  shareRestrictionMessage?: string | null;
  onOpenAccountPanel?: () => void;
  onShareUnavailable?: () => void;
  shareInviteValue: string;
  shareInviteStatus: 'idle' | 'sending' | 'success' | 'error';
  shareInviteMessage?: string | null;
  onShareInviteChange: (value: string) => void;
  onSendShareInvite: () => void;
  onViewportSizeChange?: (size: ViewportSize) => void;
  onBeginPath?: () => void;
  onStrokeColorUsed?: (color: string) => void;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
const GRID_SPACING = 80;
const TEXTBOX_PLACEMENT_OFFSET_Y = 16;
const TEXTBOX_PLACEMENT_OFFSET_X = 6.4;
const TEXTBOX_BASE_WIDTH = GRID_SPACING * 2; // 2 grid spaces
const TEXTBOX_MIN_HEIGHT = GRID_SPACING; // 1 grid space height
const TEXTBOX_MAX_WIDTH = GRID_SPACING * 12;
const STICKY_DEFAULT_WIDTH = 220;
const STICKY_DEFAULT_HEIGHT = 120;
const LABEL_BASE_WIDTH = GRID_SPACING * 0.9;
const LABEL_MIN_HEIGHT = GRID_SPACING * 0.6;
const LABEL_MAX_WIDTH = GRID_SPACING * 4;
const IMAGE_FALLBACK_WIDTH = 320;
const IMAGE_FALLBACK_HEIGHT = 240;
const clampTextScale = (value: number) => Math.min(Math.max(value, 0.5), TEXT_SIZE_PRESETS[TEXT_SIZE_PRESETS.length - 1]);

type ResizeHandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeHandleConfig {
  id: ResizeHandleId;
  xDir: -1 | 0 | 1;
  yDir: -1 | 0 | 1;
  cursor: string;
  style: CSSProperties;
}

const TEXTBOX_RESIZE_HANDLES: ResizeHandleConfig[] = [
  {
    id: 'n',
    xDir: 0,
    yDir: -1,
    cursor: 'ns-resize',
    style: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' }
  },
  {
    id: 's',
    xDir: 0,
    yDir: 1,
    cursor: 'ns-resize',
    style: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'e',
    xDir: 1,
    yDir: 0,
    cursor: 'ew-resize',
    style: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'w',
    xDir: -1,
    yDir: 0,
    cursor: 'ew-resize',
    style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'ne',
    xDir: 1,
    yDir: -1,
    cursor: 'nesw-resize',
    style: { left: '100%', top: 0, transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'nw',
    xDir: -1,
    yDir: -1,
    cursor: 'nwse-resize',
    style: { left: 0, top: 0, transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'se',
    xDir: 1,
    yDir: 1,
    cursor: 'nwse-resize',
    style: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)' }
  },
  {
    id: 'sw',
    xDir: -1,
    yDir: 1,
    cursor: 'nesw-resize',
    style: { left: 0, top: '100%', transform: 'translate(-50%, -50%)' }
  }
];

interface TouchPoint {
  x: number;
  y: number;
}

type TouchGestureState =
  | {
      type: 'pan';
      originCamera: CameraState;
      originCentroid: TouchPoint;
    }
  | {
      type: 'zoom';
      originCamera: CameraState;
      originDistance: number;
      anchorWorld: WorldPoint;
    };

const getPathBoundingBox = (path: CanvasPath): BoundingBox | null => {
  if (path.points.length === 0) return null;
  let minX = path.points[0].x;
  let maxX = path.points[0].x;
  let minY = path.points[0].y;
  let maxY = path.points[0].y;
  for (let i = 1; i < path.points.length; i += 1) {
    const point = path.points[i];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

const distancePointToSegment = (point: WorldPoint, start: WorldPoint, end: WorldPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = start.x + clamped * dx;
  const projY = start.y + clamped * dy;
  return Math.hypot(point.x - projX, point.y - projY);
};

const getPointToPathDistance = (path: CanvasPath, point: WorldPoint) => {
  if (path.points.length === 0) return Infinity;
  if (path.points.length === 1) {
    return Math.hypot(point.x - path.points[0].x, point.y - path.points[0].y);
  }
  let minDistance = Infinity;
  for (let i = 0; i < path.points.length - 1; i += 1) {
    const distance = distancePointToSegment(point, path.points[i], path.points[i + 1]);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }
  return minDistance;
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getLinePoints = (start: WorldPoint, end: WorldPoint) => [
  { x: start.x, y: start.y },
  { x: end.x, y: end.y }
];

const getArrowPoints = (start: WorldPoint, end: WorldPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const headLength = clampNumber(length * 0.2, 10, 32);
  const headWidth = headLength * 0.6;
  const unitX = dx / length;
  const unitY = dy / length;
  const baseX = end.x - unitX * headLength;
  const baseY = end.y - unitY * headLength;
  const normalX = -unitY;
  const normalY = unitX;
  const leftPoint = {
    x: baseX + normalX * headWidth,
    y: baseY + normalY * headWidth
  };
  const rightPoint = {
    x: baseX - normalX * headWidth,
    y: baseY - normalY * headWidth
  };
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
    leftPoint,
    { x: end.x, y: end.y },
    rightPoint
  ];
};

const getRectanglePoints = (start: WorldPoint, end: WorldPoint) => {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY }
  ];
};

const getBoundsFromPoints = (start: WorldPoint, end: WorldPoint) => {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  return { minX, minY, maxX, maxY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
};

const addArcPoints = (
  points: WorldPoint[],
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  startAngle: number,
  endAngle: number,
  steps = 6
) => {
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push({
      x: cx + Math.cos(angle) * radiusX,
      y: cy + Math.sin(angle) * radiusY
    });
  }
};

const getRoundedRectanglePoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY, width, height } = getBoundsFromPoints(start, end);
  const radius = clampNumber(Math.min(width, height) * 0.2, 4, Math.min(width, height) / 2);
  const rx = Math.min(radius, width / 2);
  const ry = Math.min(radius, height / 2);
  const points: WorldPoint[] = [];
  points.push({ x: minX + rx, y: minY });
  points.push({ x: maxX - rx, y: minY });
  addArcPoints(points, maxX - rx, minY + ry, -Math.PI / 2, 0);
  points.push({ x: maxX, y: maxY - ry });
  addArcPoints(points, maxX - rx, maxY - ry, 0, Math.PI / 2);
  points.push({ x: minX + rx, y: maxY });
  addArcPoints(points, minX + rx, maxY - ry, Math.PI / 2, Math.PI);
  points.push({ x: minX, y: minY + ry });
  addArcPoints(points, minX + rx, minY + ry, Math.PI, 1.5 * Math.PI);
  points.push({ x: minX + rx, y: minY });
  return points;
};

const getEllipsePoints = (start: WorldPoint, end: WorldPoint) => {
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const radiusX = Math.abs(end.x - start.x) / 2;
  const radiusY = Math.abs(end.y - start.y) / 2;
  const minRadius = 2;
  if (radiusX < minRadius && radiusY < minRadius) {
    return getLinePoints(start, end);
  }
  const segments = Math.max(24, Math.round((radiusX + radiusY) / 4));
  const points: WorldPoint[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY
    });
  }
  return points;
};

const getTrianglePoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const centerX = (minX + maxX) / 2;
  return [
    { x: centerX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: centerX, y: minY }
  ];
};

const getRightTrianglePoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  return [
    { x: minX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY }
  ];
};

const getDiamondPoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return [
    { x: centerX, y: minY },
    { x: maxX, y: centerY },
    { x: centerX, y: maxY },
    { x: minX, y: centerY },
    { x: centerX, y: minY }
  ];
};

const getRegularPolygonPoints = (
  sides: number,
  start: WorldPoint,
  end: WorldPoint,
  rotationOffset = -Math.PI / 2
) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radiusX = Math.max((maxX - minX) / 2, 1);
  const radiusY = Math.max((maxY - minY) / 2, 1);
  const points: WorldPoint[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotationOffset + (i / sides) * Math.PI * 2;
    points.push({
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY
    });
  }
  points.push(points[0]);
  return points;
};

const getStarPoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const outerRadius = Math.min((maxX - minX), (maxY - minY)) / 2;
  const innerRadius = outerRadius * 0.45;
  const totalPoints = 10;
  const points: WorldPoint[] = [];
  for (let i = 0; i < totalPoints; i += 1) {
    const angle = -Math.PI / 2 + (i / totalPoints) * Math.PI * 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  }
  points.push(points[0]);
  return points;
};

type AxisDirection = 'up' | 'down' | 'left' | 'right';

const appendAxisArrow = (points: WorldPoint[], tip: WorldPoint, direction: AxisDirection, size: number) => {
  let first: WorldPoint;
  let second: WorldPoint;
  switch (direction) {
    case 'up':
      first = { x: tip.x - size * 0.6, y: tip.y + size };
      second = { x: tip.x + size * 0.6, y: tip.y + size };
      break;
    case 'down':
      first = { x: tip.x - size * 0.6, y: tip.y - size };
      second = { x: tip.x + size * 0.6, y: tip.y - size };
      break;
    case 'left':
      first = { x: tip.x + size, y: tip.y - size * 0.6 };
      second = { x: tip.x + size, y: tip.y + size * 0.6 };
      break;
    case 'right':
    default:
      first = { x: tip.x - size, y: tip.y - size * 0.6 };
      second = { x: tip.x - size, y: tip.y + size * 0.6 };
      break;
  }
  points.push(first);
  points.push(tip);
  points.push(second);
  points.push(tip);
};

const getEconGraphPoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const origin: WorldPoint = { x: minX, y: maxY };
  const top: WorldPoint = { x: minX, y: minY };
  const right: WorldPoint = { x: maxX, y: maxY };
  const arrowSize = clampNumber(Math.min(maxX - minX, maxY - minY) * 0.15, 8, 26);
  const points: WorldPoint[] = [];
  points.push(origin);
  points.push(top);
  appendAxisArrow(points, top, 'up', arrowSize);
  points.push(origin);
  points.push(right);
  appendAxisArrow(points, right, 'right', arrowSize);
  return points;
};

const getMathGraphPoints = (start: WorldPoint, end: WorldPoint) => {
  const { minX, minY, maxX, maxY } = getBoundsFromPoints(start, end);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const top: WorldPoint = { x: centerX, y: minY };
  const bottom: WorldPoint = { x: centerX, y: maxY };
  const left: WorldPoint = { x: minX, y: centerY };
  const right: WorldPoint = { x: maxX, y: centerY };
  const center: WorldPoint = { x: centerX, y: centerY };
  const arrowSize = clampNumber(Math.min(maxX - minX, maxY - minY) * 0.12, 8, 24);
  const points: WorldPoint[] = [];
  points.push(bottom);
  points.push(top);
  appendAxisArrow(points, top, 'up', arrowSize);
  points.push(bottom);
  appendAxisArrow(points, bottom, 'down', arrowSize);
  points.push(center);
  points.push(left);
  appendAxisArrow(points, left, 'left', arrowSize);
  points.push(center);
  points.push(right);
  appendAxisArrow(points, right, 'right', arrowSize);
  points.push(center);
  return points;
};

const getShapePoints = (shape: ShapeTool, start: WorldPoint, end: WorldPoint) => {
  switch (shape) {
    case 'line':
      return getLinePoints(start, end);
    case 'arrow':
      return getArrowPoints(start, end);
    case 'rectangle':
      return getRectanglePoints(start, end);
    case 'rounded-rectangle':
      return getRoundedRectanglePoints(start, end);
    case 'ellipse':
      return getEllipsePoints(start, end);
    case 'triangle':
      return getTrianglePoints(start, end);
    case 'right-triangle':
      return getRightTrianglePoints(start, end);
    case 'diamond':
      return getDiamondPoints(start, end);
    case 'hexagon':
      return getRegularPolygonPoints(6, start, end);
    case 'star':
      return getStarPoints(start, end);
    case 'econ-graph':
      return getEconGraphPoints(start, end);
    case 'math-graph':
      return getMathGraphPoints(start, end);
    case 'freeform':
    default:
      return [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y }
      ];
  }
};

const COPY_PASTE_OFFSET_STEP = 24;

interface SelectionTargetSnapshot {
  pathId: string;
  originalPoints: WorldPoint[];
  originalMasks: CanvasMask[];
  originalCurve: CurveShape | null;
}

interface TextSelectionTarget {
  id: string;
  originX: number;
  originY: number;
  ignoreLock?: boolean;
}

type SelectionInteraction =
  | {
      type: 'move';
      pointerId: number;
      origin: WorldPoint;
      hasMutated: boolean;
      targets: SelectionTargetSnapshot[];
      textTargets: TextSelectionTarget[];
    }
  | {
      type: 'scale';
      pointerId: number;
      handle: SelectionHandle;
      originBox: BoundingBox;
      minSize: number;
      hasMutated: boolean;
      targets: SelectionTargetSnapshot[];
    }
  | {
      type: 'rotate';
      pointerId: number;
      center: WorldPoint;
      startAngle: number;
      hasMutated: boolean;
      targets: SelectionTargetSnapshot[];
    };

interface CurveHandleInteractionState {
  handle: CurveHandleDescriptor;
  pointerId: number;
  pathId: string;
  originCurve: CurveShape;
  grabOffset: WorldPoint;
  stage: 'pending' | 'active';
  hasMutated: boolean;
}

interface MarqueeInteraction {
  pointerId: number;
  originLocal: TouchPoint;
  originWorld: WorldPoint;
  currentLocal: TouchPoint;
  currentWorld: WorldPoint;
  additive: boolean;
}

const HANDLE_CONFIG: Array<{ id: SelectionHandle; x: number; y: number; cursor: string }> = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' }
];

const getTouchCentroid = (points: TouchPoint[]): TouchPoint => {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
};

const getAverageDistance = (points: TouchPoint[], centroid: TouchPoint) => {
  if (points.length === 0) return 0;
  const total = points.reduce(
    (acc, point) => acc + Math.hypot(point.x - centroid.x, point.y - centroid.y),
    0
  );
  return total / points.length;
};

const sampleStrokePoints = (points: WorldPoint[], step: number): WorldPoint[] => {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const samples: WorldPoint[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const segments = Math.max(1, Math.ceil(length / step));
    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      const point = {
        x: start.x + dx * t,
        y: start.y + dy * t
      };
      const prevPoint = samples[samples.length - 1];
      if (prevPoint && Math.abs(prevPoint.x - point.x) < 1e-4 && Math.abs(prevPoint.y - point.y) < 1e-4) {
        continue;
      }
      samples.push(point);
    }
  }
  return samples;
};

const doesMaskAffectPath = (
  path: CanvasPath,
  samples: WorldPoint[],
  radius: number
) => {
  const bounds = getPathBoundingBox(path);
  if (!bounds) return false;
  const threshold = radius + Math.max(path.width, 0) / 2 + 0.5;
  for (let i = 0; i < samples.length; i += 1) {
    const point = samples[i];
    if (
      point.x < bounds.minX - threshold ||
      point.x > bounds.maxX + threshold ||
      point.y < bounds.minY - threshold ||
      point.y > bounds.maxY + threshold
    ) {
      continue;
    }
    const distance = getPointToPathDistance(path, point);
    if (distance <= threshold) {
      return true;
    }
  }
  return false;
};

const cloneMasks = (masks?: CanvasMask[]) =>
  masks?.map(mask => ({
    id: mask.id,
    width: mask.width,
    points: mask.points.map(point => ({ ...point }))
  })) ?? [];

const translateMasks = (masks: CanvasMask[], deltaX: number, deltaY: number) =>
  masks.map(mask => ({
    ...mask,
    points: mask.points.map(point => ({
      x: point.x + deltaX,
      y: point.y + deltaY
    }))
  }));

const scaleMasks = (
  masks: CanvasMask[],
  originBox: BoundingBox,
  originalWidth: number,
  originalHeight: number,
  newMinX: number,
  newMinY: number,
  newWidth: number,
  newHeight: number
) =>
  masks.map(mask => ({
    ...mask,
    points: mask.points.map(point => {
      const relX = (point.x - originBox.minX) / originalWidth;
      const relY = (point.y - originBox.minY) / originalHeight;
      return {
        x: newMinX + relX * newWidth,
        y: newMinY + relY * newHeight
      };
    })
  }));

const rotateMasks = (
  masks: CanvasMask[],
  center: WorldPoint,
  cos: number,
  sin: number
) =>
  masks.map(mask => ({
    ...mask,
    points: mask.points.map(point => {
      const relX = point.x - center.x;
      const relY = point.y - center.y;
      return {
        x: center.x + relX * cos - relY * sin,
        y: center.y + relX * sin + relY * cos
      };
    })
  }));

const cloneCanvasPath = (path: CanvasPath): CanvasPath => {
  const clonedCurve = path.curve ? cloneCurve(path.curve) : undefined;
  const clonedMasks = path.eraserMasks ? cloneMasks(path.eraserMasks) : undefined;
  return {
    ...path,
    points: path.points.map(point => ({ ...point })),
    eraserMasks: clonedMasks,
    curve: clonedCurve,
    shapeType: path.shapeType
  };
};

const getTextNodeSize = (node: CanvasTextNode) => {
  if (node.kind === 'sticky') {
    return {
      width: node.width ?? STICKY_DEFAULT_WIDTH,
      height: node.height ?? STICKY_DEFAULT_HEIGHT
    };
  }
  if (node.kind === 'label') {
    return {
      width: node.width ?? LABEL_BASE_WIDTH,
      height: node.height ?? LABEL_MIN_HEIGHT
    };
  }
  return {
    width: node.width ?? TEXTBOX_BASE_WIDTH,
    height: node.height ?? TEXTBOX_MIN_HEIGHT
  };
};

const translatePathPoints = (points: WorldPoint[], deltaX: number, deltaY: number) =>
  points.map(point => ({
    x: point.x + deltaX,
    y: point.y + deltaY
  }));

const createPastedPath = (path: CanvasPath, deltaX: number, deltaY: number): CanvasPath => {
  const translatedCurve =
    path.curve && path.pathKind === 'curve' ? translateCurve(path.curve, deltaX, deltaY) : path.curve;
  return {
    ...path,
    id: crypto.randomUUID(),
    points: translatePathPoints(path.points, deltaX, deltaY),
    curve: translatedCurve,
    eraserMasks: path.eraserMasks ? translateMasks(path.eraserMasks, deltaX, deltaY) : path.eraserMasks,
    shapeType: path.shapeType
  };
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
};

const blurActiveTextNodeInput = () => {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLTextAreaElement &&
    activeElement.closest('.text-node')
  ) {
    activeElement.blur();
  }
};

const createCurveFromPoints = (start: WorldPoint, end: WorldPoint): CurveShape => {
  const offset = {
    x: (end.x - start.x) / 3,
    y: (end.y - start.y) / 3
  };
  return {
    nodes: [
      { anchor: { ...start } },
      { anchor: { ...end } }
    ]
  };
};

const getSegmentControlPoints = (curve: CurveShape, index: number) => {
  const startNode = curve.nodes[index];
  const endNode = curve.nodes[index + 1];
  const p0 = startNode.anchor;
  const p1 = startNode.handleOut ?? startNode.anchor;
  const p2 = endNode.handleIn ?? endNode.anchor;
  const p3 = endNode.anchor;
  return { p0, p1, p2, p3 };
};

const generateCurvePoints = (curve: CurveShape, segmentsPerNode = 24): WorldPoint[] => {
  const points: WorldPoint[] = [];
  if (!curve.nodes.length) return points;
  curve.nodes.forEach((node, nodeIndex) => {
    if (nodeIndex === curve.nodes.length - 1) {
      if (points.length === 0) points.push({ ...node.anchor });
      return;
    }
    const { p0, p1, p2, p3 } = getSegmentControlPoints(curve, nodeIndex);
    for (let i = 0; i <= segmentsPerNode; i += 1) {
      const t = i / segmentsPerNode;
      const mt = 1 - t;
      const x =
        mt * mt * mt * p0.x +
        3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x +
        t * t * t * p3.x;
      const y =
        mt * mt * mt * p0.y +
        3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y +
        t * t * t * p3.y;
      if (nodeIndex > 0 && i === 0) continue;
      points.push({ x, y });
    }
  });
  return points;
};

const cloneCurve = (curve?: CurveShape | null): CurveShape | null => {
  if (!curve) return null;
  return {
    nodes: curve.nodes.map(node => ({
      anchor: { ...node.anchor },
      handleIn: node.handleIn ? { ...node.handleIn } : null,
      handleOut: node.handleOut ? { ...node.handleOut } : null
    }))
  };
};

const translateCurve = (curve: CurveShape, deltaX: number, deltaY: number): CurveShape => ({
  nodes: curve.nodes.map(node => ({
    anchor: { x: node.anchor.x + deltaX, y: node.anchor.y + deltaY },
    handleIn: node.handleIn
      ? { x: node.handleIn.x + deltaX, y: node.handleIn.y + deltaY }
      : null,
    handleOut: node.handleOut
      ? { x: node.handleOut.x + deltaX, y: node.handleOut.y + deltaY }
      : null
  }))
});

const scaleCurve = (
  curve: CurveShape,
  originBox: BoundingBox,
  originalWidth: number,
  originalHeight: number,
  newMinX: number,
  newMinY: number,
  newWidth: number,
  newHeight: number
): CurveShape => {
  const toScaled = (point: WorldPoint) => {
    const relX = (point.x - originBox.minX) / originalWidth;
    const relY = (point.y - originBox.minY) / originalHeight;
    return {
      x: newMinX + relX * newWidth,
      y: newMinY + relY * newHeight
    };
  };
  return {
    nodes: curve.nodes.map(node => ({
      anchor: toScaled(node.anchor),
      handleIn: node.handleIn ? toScaled(node.handleIn) : null,
      handleOut: node.handleOut ? toScaled(node.handleOut) : null
    }))
  };
};

const rotateCurve = (curve: CurveShape, center: WorldPoint, cos: number, sin: number): CurveShape => {
  const rotatePoint = (point: WorldPoint) => {
    const relX = point.x - center.x;
    const relY = point.y - center.y;
    return {
      x: center.x + relX * cos - relY * sin,
      y: center.y + relX * sin + relY * cos
    };
  };
  return {
    nodes: curve.nodes.map(node => ({
      anchor: rotatePoint(node.anchor),
      handleIn: node.handleIn ? rotatePoint(node.handleIn) : null,
      handleOut: node.handleOut ? rotatePoint(node.handleOut) : null
    }))
  };
};

const getCurveHandlePoint = (curve: CurveShape, handle: CurveHandleDescriptor): WorldPoint => {
  const node = curve.nodes[handle.nodeIndex];
  if (!node) return { x: 0, y: 0 };
  if (handle.kind === 'anchor') {
    return node.anchor;
  }
  if (handle.kind === 'handleIn') {
    return node.handleIn ?? node.anchor;
  }
  return node.handleOut ?? node.anchor;
};

const splitCubicSegment = (
  p0: WorldPoint,
  p1: WorldPoint,
  p2: WorldPoint,
  p3: WorldPoint,
  t: number
) => {
  const lerp = (a: WorldPoint, b: WorldPoint, amount: number): WorldPoint => ({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  });
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p0123 = lerp(p012, p123, t);
  return {
    left: { p0, p1: p01, p2: p012, p3: p0123 },
    right: { p0: p0123, p1: p123, p2: p23, p3 }
  };
};

const findClosestPointOnCurve = (curve: CurveShape, point: WorldPoint) => {
  let best = {
    nodeIndex: 0,
    t: 0,
    distance: Infinity
  };
  curve.nodes.forEach((_, index) => {
    if (index === curve.nodes.length - 1) return;
    const { p0, p1, p2, p3 } = getSegmentControlPoints(curve, index);
    const samples = 40;
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const mt = 1 - t;
      const sample = {
        x:
          mt * mt * mt * p0.x +
          3 * mt * mt * t * p1.x +
          3 * mt * t * t * p2.x +
          t * t * t * p3.x,
        y:
          mt * mt * mt * p0.y +
          3 * mt * mt * t * p1.y +
          3 * mt * t * t * p2.y +
          t * t * t * p3.y
      };
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y);
      if (distance < best.distance) {
        best = { nodeIndex: index, t, distance };
      }
    }
  });
  return best;
};

const insertCurveNodeAtPoint = (curve: CurveShape, worldPoint: WorldPoint) => {
  if (curve.nodes.length < 2) {
    return { curve, insertedIndex: 0 };
  }
  const closest = findClosestPointOnCurve(curve, worldPoint);
  const { p0, p1, p2, p3 } = getSegmentControlPoints(curve, closest.nodeIndex);
  const split = splitCubicSegment(p0, p1, p2, p3, closest.t);
  const newNode: CurveNode = {
    anchor: split.left.p3,
    handleIn: split.left.p2,
    handleOut: split.right.p1
  };
  const newNodes = curve.nodes.map(node => ({
    anchor: { ...node.anchor },
    handleIn: node.handleIn ? { ...node.handleIn } : null,
    handleOut: node.handleOut ? { ...node.handleOut } : null
  }));
  const startNode = newNodes[closest.nodeIndex];
  const endNode = newNodes[closest.nodeIndex + 1];
  startNode.handleOut = split.left.p1;
  endNode.handleIn = split.right.p2;
  newNodes.splice(closest.nodeIndex + 1, 0, newNode);
  return { curve: { nodes: newNodes }, insertedIndex: closest.nodeIndex + 1 };
};

const mapCurveHandles = (curve: CurveShape): CurveHandleDescriptor[] => {
  const handles: CurveHandleDescriptor[] = [];
  curve.nodes.forEach((node, index) => {
    handles.push({ kind: 'anchor', nodeIndex: index });
    if (node.handleOut) handles.push({ kind: 'handleOut', nodeIndex: index });
    if (node.handleIn) handles.push({ kind: 'handleIn', nodeIndex: index });
  });
  return handles;
};

const findNearestCurveHandle = (
  curve: CurveShape,
  point: WorldPoint,
  threshold: number
): CurveHandleDescriptor | null => {
  const handles = mapCurveHandles(curve);
  let closest: CurveHandleDescriptor | null = null;
  let minDistance = threshold;
  handles.forEach(handle => {
    const handlePoint = getCurveHandlePoint(curve, handle);
    const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y);
    if (distance <= minDistance) {
      closest = handle;
      minDistance = distance;
    }
  });
  return closest;
};


const CanvasViewport = ({
  mode,
  drawTool,
  shapeTool,
  drawColor,
  strokeScale,
  camera,
  setCamera,
  paths,
  setPaths,
  textNodes,
  imageNodes,
  onRequestTextNode,
  onUpdateTextNode,
  onDeleteTextNode,
  onMoveTextNode,
  onResizeTextNode,
  onUpdateTextNodeStyle,
  onDeleteImageNode,
  onMoveImageNode,
  onResizeImageNode,
  onImageDrawComplete,
  onImageDrawCancel,
  imageToolEnabled = true,
  onCopyTextNode,
  onCutTextNode,
  onDuplicateTextNode,
  onReorderTextNode,
  pendingFocusId,
  clearPendingFocus,
  shareId,
  shareStatus,
  sharePresenceCount,
  accountEmail,
  username,
  canUseShare,
  shareRestrictionMessage,
  onOpenAccountPanel,
  onShareUnavailable,
  shareInviteValue,
  shareInviteStatus,
  shareInviteMessage,
  onShareInviteChange,
  onSendShareInvite,
  onViewportSizeChange,
  onBeginPath,
  onStrokeColorUsed
}: CanvasViewportProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const collaborationOverlayRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panOrigin = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const activePathId = useRef<string | null>(null);
  const activePointerId = useRef<number | null>(null);
  const currentAction = useRef<'draw' | 'erase' | 'curve' | null>(null);
  const activeShapeTool = useRef<ShapeTool>('freeform');
  const shapeOrigin = useRef<WorldPoint | null>(null);
  const curveDraftRef = useRef<CurveShape | null>(null);
  const pathsRef = useRef<CanvasPath[]>(paths);
  const touchPoints = useRef<Map<number, TouchPoint>>(new Map());
  const touchGesture = useRef<TouchGestureState | null>(null);
  const cameraRef = useRef(camera);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [selectedTextNodeIds, setSelectedTextNodeIds] = useState<string[]>([]);
  const imagePlacementInteraction = useRef<{ pointerId: number; start: WorldPoint } | null>(null);
  const [imageDraftRect, setImageDraftRect] = useState<ImagePlacement | null>(null);
  const [isCollaborationOpen, setIsCollaborationOpen] = useState(false);
  const imageToolActive = imageToolEnabled && drawTool === 'image';

  const handleCollaborationButtonClick = () => {
    if (!canUseShare) {
      if (onShareUnavailable) {
        onShareUnavailable();
      } else {
        onOpenAccountPanel?.();
      }
      return;
    }
    setIsCollaborationOpen(true);
  };

  const handleCloseCollaborationOverlay = () => {
    setIsCollaborationOpen(false);
  };

  const clearTextNodeSelection = useCallback(() => {
    setSelectedTextNodeIds([]);
  }, []);
  const [liveCurveEditPathId, setLiveCurveEditPathId] = useState<string | null>(null);
  const selectionInteraction = useRef<SelectionInteraction | null>(null);
  const pendingHandleInteraction = useRef<
    | { type: 'scale'; handle: SelectionHandle; pointerId: number }
    | { type: 'rotate'; pointerId: number }
    | null
  >(null);
  const curveHandleInteraction = useRef<CurveHandleInteractionState | null>(null);
  const marqueeInteraction = useRef<MarqueeInteraction | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const copyBufferRef = useRef<CanvasPath[] | null>(null);
  const pasteOffsetRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [textContextMenu, setTextContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const textContextMenuRef = useRef<HTMLDivElement | null>(null);
  const closeTextContextMenu = useCallback(() => setTextContextMenu(null), []);

  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  useEffect(() => {
    if ((!imageToolEnabled || drawTool !== 'image') && imagePlacementInteraction.current) {
      imagePlacementInteraction.current = null;
      setImageDraftRect(null);
      onImageDrawCancel?.();
    }
    if (!imageToolEnabled || drawTool !== 'image') {
      setImageDraftRect(null);
    }
  }, [drawTool, imageToolEnabled, onImageDrawCancel]);

  const getAttachedTextNodesForPaths = useCallback(
    (pathsToInclude: CanvasPath[]) => {
      if (!pathsToInclude.length) return [];
      const parentIds = new Set(pathsToInclude.map(path => path.id));
      return textNodes.filter(node => node.parentPathId && parentIds.has(node.parentPathId));
    },
    [textNodes]
  );

  const deleteAttachedTextNodes = useCallback(
    (parentIds: Set<string>) => {
      if (!parentIds.size) return;
      textNodes.forEach(node => {
        if (node.parentPathId && parentIds.has(node.parentPathId)) {
          onDeleteTextNode(node.id);
        }
      });
    },
    [onDeleteTextNode, textNodes]
  );

  const addGraphLabelsForPath = useCallback(() => {}, []);

  const getTouchPointsArray = () => Array.from(touchPoints.current.values());

  const cancelActiveDrawing = () => {
    if (activePointerId.current !== null) {
      containerRef.current?.releasePointerCapture(activePointerId.current);
    }
    endDraw();
    currentAction.current = null;
  };

  const beginTouchPan = (points: TouchPoint[], cancelDrawing: boolean) => {
    if (cancelDrawing) {
      cancelActiveDrawing();
    }
    const centroid = getTouchCentroid(points);
    touchGesture.current = {
      type: 'pan',
      originCamera: cameraRef.current,
      originCentroid: centroid
    };
  };

  const beginTouchZoom = (points: TouchPoint[], cancelDrawing: boolean) => {
    if (cancelDrawing) {
      cancelActiveDrawing();
    }
    const centroid = getTouchCentroid(points);
    const distance = Math.max(getAverageDistance(points, centroid), 1);
    const currentCamera = cameraRef.current;
    const anchorWorld = {
      x: (centroid.x - currentCamera.x) / currentCamera.scale,
      y: (centroid.y - currentCamera.y) / currentCamera.scale
    };
    touchGesture.current = {
      type: 'zoom',
      originCamera: currentCamera,
      originDistance: distance,
      anchorWorld
    };
  };

  const maybeStartTouchGesture = (points: TouchPoint[], cancelDrawing: boolean) => {
    if (points.length >= 3) {
      if (touchGesture.current?.type !== 'pan') {
        beginTouchPan(points, cancelDrawing);
      }
      return;
    }
    if (points.length === 2) {
      if (touchGesture.current?.type !== 'zoom') {
        beginTouchZoom(points, cancelDrawing);
      }
      return;
    }
    touchGesture.current = null;
  };

  const updateTouchGesture = () => {
    const gesture = touchGesture.current;
    if (!gesture) return;
    const points = getTouchPointsArray();
    if (gesture.type === 'pan') {
      if (points.length < 3) return;
      const centroid = getTouchCentroid(points);
      setCamera({
        x: gesture.originCamera.x + (centroid.x - gesture.originCentroid.x),
        y: gesture.originCamera.y + (centroid.y - gesture.originCentroid.y),
        scale: gesture.originCamera.scale
      });
      return;
    }
    if (points.length < 2) return;
    const centroid = getTouchCentroid(points);
    const distance = Math.max(getAverageDistance(points, centroid), 1);
    const scaleRatio = distance / gesture.originDistance;
    const targetScale = clampZoom(gesture.originCamera.scale * scaleRatio);
    const newX = centroid.x - gesture.anchorWorld.x * targetScale;
    const newY = centroid.y - gesture.anchorWorld.y * targetScale;
    setCamera({
      x: newX,
      y: newY,
      scale: targetScale
    });
  };

  const getStrokeStyle = useCallback(() => {
    const multiplier = 0.4 + strokeScale * 2.6;
    const eraserScale = Math.max(strokeScale, 0.5);
    const baseColor = drawTool === 'eraser' ? 'erase' : drawColor;
    switch (drawTool) {
      case 'pencil':
        return { width: 1.2 * multiplier, color: baseColor, opacity: 0.9 };
      case 'cursor':
        return { width: 2.5 * multiplier, color: baseColor, opacity: 1 };
      case 'highlighter':
        return {
          width: 8 * multiplier,
          color: baseColor,
          opacity: 0.25
        };
      case 'eraser':
        return { width: 12 * (0.4 + eraserScale * 3), color: 'erase', opacity: 1 };
      case 'pen':
      default:
        return { width: 2.5 * multiplier, color: baseColor, opacity: 1 };
    }
  }, [drawColor, drawTool, strokeScale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const finalizeLiveCurveEditing = useCallback(() => {
    setLiveCurveEditPathId(prev => {
      if (!prev) return null;
      if (drawTool !== 'cursor') {
        setSelectedPathIds(current => current.filter(id => id !== prev));
      }
      return null;
    });
  }, [drawTool]);

  useEffect(() => {
    if (!liveCurveEditPathId) return;
    if (mode !== 'draw' || shapeTool !== 'curve') {
      finalizeLiveCurveEditing();
    }
  }, [finalizeLiveCurveEditing, liveCurveEditPathId, mode, shapeTool]);

  const singleSelectedPathId = selectedPathIds.length === 1 ? selectedPathIds[0] : null;

  const selectedPath = useMemo(
    () =>
      singleSelectedPathId ? paths.find(path => path.id === singleSelectedPathId) ?? null : null,
    [paths, singleSelectedPathId]
  );

  const selectedPaths = useMemo(() => {
    if (!selectedPathIds.length) return [];
    const selectedSet = new Set(selectedPathIds);
    return paths.filter(path => selectedSet.has(path.id));
  }, [paths, selectedPathIds]);
  const selectedTextNodes = useMemo(() => {
    if (!selectedTextNodeIds.length) return [];
    const selectedSet = new Set(selectedTextNodeIds);
    return textNodes.filter(node => selectedSet.has(node.id));
  }, [selectedTextNodeIds, textNodes]);
  const hasLockedSelection = selectedPaths.some(path => path.locked);
  const hasUnlockedSelection = selectedPaths.some(path => !path.locked);

  const hasSelection = selectedPathIds.length > 0;
  const hasClipboardItems = !!(copyBufferRef.current && copyBufferRef.current.length);
  const canPasteFromClipboard = mode === 'draw' && hasClipboardItems;

  useEffect(() => {
    setSelectedPathIds(prev =>
      prev.filter(id => paths.some(path => path.id === id))
    );
  }, [paths]);

  useEffect(() => {
    if (!textContextMenu) return;
    if (!textNodes.some(node => node.id === textContextMenu.id)) {
      setTextContextMenu(null);
    }
  }, [textContextMenu, textNodes]);

  const textContextTarget = useMemo(() => {
    if (!textContextMenu) return null;
    return textNodes.find(node => node.id === textContextMenu.id) ?? null;
  }, [textContextMenu, textNodes]);
  const textContextScaleValue = textContextTarget
    ? TEXT_SIZE_PRESETS.includes(textContextTarget.fontScale ?? 1)
      ? String(textContextTarget.fontScale ?? 1)
      : (textContextTarget.fontScale ?? 1).toFixed(2)
    : '1';
  const textContextFontValue = textContextTarget?.fontFamily ?? FONT_PRESETS[0];

  const handleTextContextSizeSelect = useCallback((value: string) => {
    if (!textContextMenu) return;
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return;
    const clamped = clampTextScale(numeric);
    onUpdateTextNodeStyle(textContextMenu.id, {
      fontScale: clamped,
      fontScaleLocked: true,
      width: undefined,
      height: undefined
    });
  }, [onUpdateTextNodeStyle, textContextMenu]);

  const handleTextContextFontSelect = useCallback((value: string) => {
    if (!textContextMenu) return;
    onUpdateTextNodeStyle(textContextMenu.id, { fontFamily: value });
  }, [onUpdateTextNodeStyle, textContextMenu]);

  const handleTextContextColorSelect = useCallback((value: string) => {
    if (!textContextMenu) return;
    onUpdateTextNodeStyle(textContextMenu.id, { color: value });
  }, [onUpdateTextNodeStyle, textContextMenu]);

  const handleTextContextLockToggle = useCallback(() => {
    if (!textContextMenu) return;
    const target = textNodes.find(node => node.id === textContextMenu.id);
    if (!target) return;
    onUpdateTextNodeStyle(textContextMenu.id, { locked: !target.locked });
    closeTextContextMenu();
  }, [closeTextContextMenu, onUpdateTextNodeStyle, textContextMenu, textNodes]);

  const handleTextContextAction = useCallback((action: 'copy' | 'cut' | 'duplicate' | 'delete' | 'forward' | 'backward' | 'front' | 'back') => {
    if (!textContextMenu) return;
    const id = textContextMenu.id;
    switch (action) {
      case 'copy':
        onCopyTextNode(id);
        break;
      case 'cut':
        onCutTextNode(id);
        break;
      case 'duplicate':
        onDuplicateTextNode(id);
        break;
      case 'delete':
        onDeleteTextNode(id);
        break;
      default:
        onReorderTextNode(id, action);
        break;
    }
    closeTextContextMenu();
  }, [closeTextContextMenu, onCopyTextNode, onCutTextNode, onDeleteTextNode, onDuplicateTextNode, onReorderTextNode, textContextMenu]);

  useEffect(() => {
    setLiveCurveEditPathId(prev => {
      if (!prev) return prev;
      if (singleSelectedPathId !== prev) {
        return null;
      }
      return prev;
    });
  }, [singleSelectedPathId]);

  const isCursorToolActive = mode === 'draw' && drawTool === 'cursor';

  const isCurveLiveEditing = useMemo(
    () => !!liveCurveEditPathId && singleSelectedPathId === liveCurveEditPathId,
    [liveCurveEditPathId, singleSelectedPathId]
  );

  useEffect(() => {
    if (mode !== 'draw' || drawTool !== 'cursor') {
      if (!isCurveLiveEditing) {
        setSelectedPathIds([]);
      }
    }
  }, [drawTool, isCurveLiveEditing, mode]);

  useEffect(() => {
    setSelectedTextNodeIds(prev => prev.filter(id => textNodes.some(node => node.id === id)));
  }, [textNodes]);

  const addPathsToSelection = useCallback(
    (ids: string[], additive: boolean) => {
      if (!ids.length) return;
      setSelectedPathIds(prev => {
        const base = additive ? [...prev] : [];
        ids.forEach(id => {
          if (!base.includes(id)) {
            base.push(id);
          }
        });
        return base;
      });
    },
    []
  );

  const addTextNodesToSelection = useCallback(
    (ids: string[], additive: boolean) => {
      setSelectedTextNodeIds(prev => {
        const base = additive ? [...prev] : [];
        ids.forEach(id => {
          if (!base.includes(id)) {
            base.push(id);
          }
        });
        return base;
      });
    },
    []
  );

  const handleSelectTextNode = useCallback(
    (id: string, additive: boolean) => {
      setSelectedPathIds([]);
      addTextNodesToSelection([id], additive);
    },
    [addTextNodesToSelection]
  );

  const togglePathSelection = useCallback((pathId: string) => {
    setSelectedPathIds(prev => {
      if (prev.includes(pathId)) {
        return prev.filter(id => id !== pathId);
      }
      return [...prev, pathId];
    });
  }, []);

  const copySelection = useCallback(() => {
    if (!selectedPaths.length || mode !== 'draw') return false;
    copyBufferRef.current = selectedPaths.map(cloneCanvasPath);
    pasteOffsetRef.current = 0;
    return true;
  }, [mode, selectedPaths]);

  const pasteFromBuffer = useCallback(() => {
    const buffer = copyBufferRef.current;
    if (!buffer || !buffer.length || mode !== 'draw') return false;
    pasteOffsetRef.current += 1;
    const delta = pasteOffsetRef.current * COPY_PASTE_OFFSET_STEP;
    const pastedPaths = buffer.map(path => createPastedPath(path, delta, delta));
    onBeginPath?.();
    setPaths(prev => [...prev, ...pastedPaths]);
    setSelectedPathIds(pastedPaths.map(path => path.id));
    pastedPaths.forEach(path => {
      if (path.shapeType === 'econ-graph' || path.shapeType === 'math-graph') {
        addGraphLabelsForPath(path.shapeType, path.id, path);
      }
    });
    return true;
  }, [addGraphLabelsForPath, mode, onBeginPath, setPaths, setSelectedPathIds]);

  const cutSelection = useCallback(() => {
    if (!selectedPathIds.length) return false;
    copySelection();
    const selectedSet = new Set(selectedPathIds);
    onBeginPath?.();
    deleteAttachedTextNodes(selectedSet);
    setPaths(prev => prev.filter(path => !selectedSet.has(path.id)));
    setSelectedPathIds([]);
    return true;
  }, [copySelection, deleteAttachedTextNodes, onBeginPath, selectedPathIds, setPaths, setSelectedPathIds]);

  const deleteSelection = useCallback(() => {
    if (!selectedPathIds.length) return false;
    const selectedSet = new Set(selectedPathIds);
    onBeginPath?.();
    deleteAttachedTextNodes(selectedSet);
    setPaths(prev => prev.filter(path => !selectedSet.has(path.id)));
    setSelectedPathIds([]);
    return true;
  }, [deleteAttachedTextNodes, onBeginPath, selectedPathIds, setPaths, setSelectedPathIds]);

  const updateSelectionLockState = useCallback((locked: boolean) => {
    if (!selectedPathIds.length) return false;
    const selectedSet = new Set(selectedPathIds);
    let didChange = false;
    setPaths(prev =>
      prev.map(path => {
        if (!selectedSet.has(path.id)) return path;
        if (path.locked === locked) return path;
        didChange = true;
        return { ...path, locked };
      })
    );
    if (didChange) {
      onBeginPath?.();
    }
    return didChange;
  }, [onBeginPath, selectedPathIds, setPaths]);

  const lockSelection = useCallback(() => updateSelectionLockState(true), [updateSelectionLockState]);
  const unlockSelection = useCallback(
    () => updateSelectionLockState(false),
    [updateSelectionLockState]
  );

  const duplicateSelection = useCallback(() => {
    if (!selectedPathIds.length) return false;
    const copied = copySelection();
    if (!copied) return false;
    return pasteFromBuffer();
  }, [copySelection, pasteFromBuffer, selectedPathIds.length]);

  const reorderSelection = useCallback(
    (operation: 'forward' | 'backward' | 'front' | 'back') => {
      if (!selectedPathIds.length) return false;
      let didMutate = false;
      setPaths(prev => {
        const next = [...prev];
        const selectedSet = new Set(selectedPathIds);
        switch (operation) {
          case 'front': {
            const selected = next.filter(path => selectedSet.has(path.id));
            if (!selected.length || selected.length === next.length) return prev;
            const others = next.filter(path => !selectedSet.has(path.id));
            didMutate = true;
            return [...others, ...selected];
          }
          case 'back': {
            const selected = next.filter(path => selectedSet.has(path.id));
            if (!selected.length || selected.length === next.length) return prev;
            const others = next.filter(path => !selectedSet.has(path.id));
            didMutate = true;
            return [...selected, ...others];
          }
          case 'forward': {
            for (let i = next.length - 2; i >= 0; i -= 1) {
              if (selectedSet.has(next[i].id) && !selectedSet.has(next[i + 1].id)) {
                [next[i], next[i + 1]] = [next[i + 1], next[i]];
                didMutate = true;
              }
            }
            break;
          }
          case 'backward': {
            for (let i = 1; i < next.length; i += 1) {
              if (selectedSet.has(next[i].id) && !selectedSet.has(next[i - 1].id)) {
                [next[i], next[i - 1]] = [next[i - 1], next[i]];
                didMutate = true;
              }
            }
            break;
          }
          default:
            break;
        }
        if (!didMutate) return prev;
        return next;
      });
      if (didMutate) {
        onBeginPath?.();
      }
      return didMutate;
    },
    [onBeginPath, selectedPathIds, setPaths]
  );

  const contextMenuItems = useMemo(
    () => [
      { key: 'copy', label: 'Copy', action: copySelection, disabled: !hasSelection },
      { key: 'cut', label: 'Cut', action: cutSelection, disabled: !hasSelection },
      { key: 'paste', label: 'Paste', action: pasteFromBuffer, disabled: !canPasteFromClipboard },
      { key: 'duplicate', label: 'Duplicate', action: duplicateSelection, disabled: !hasSelection },
      { key: 'delete', label: 'Delete', action: deleteSelection, disabled: !hasSelection },
      { key: 'sep-lock', separator: true },
      {
        key: 'lock',
        label: 'Lock Position',
        action: lockSelection,
        disabled: !hasUnlockedSelection
      },
      {
        key: 'unlock',
        label: 'Unlock Position',
        action: unlockSelection,
        disabled: !hasLockedSelection
      },
      { key: 'sep-1', separator: true },
      {
        key: 'forward',
        label: 'Bring Forward',
        action: () => reorderSelection('forward'),
        disabled: !hasSelection
      },
      {
        key: 'backward',
        label: 'Send Backward',
        action: () => reorderSelection('backward'),
        disabled: !hasSelection
      },
      {
        key: 'front',
        label: 'Bring to Front',
        action: () => reorderSelection('front'),
        disabled: !hasSelection
      },
      {
        key: 'back',
        label: 'Send to Back',
        action: () => reorderSelection('back'),
        disabled: !hasSelection
      }
    ],
    [
      canPasteFromClipboard,
      copySelection,
      cutSelection,
      deleteSelection,
      duplicateSelection,
      hasSelection,
      pasteFromBuffer,
      reorderSelection,
      hasLockedSelection,
      hasUnlockedSelection,
      lockSelection,
      unlockSelection
    ]
  );

  const handleMenuAction = useCallback(
    (action: () => boolean | void) => () => {
      const result = action();
      if (result !== false) {
        closeContextMenu();
      }
    },
    [closeContextMenu, setSelectedPathIds, setSelectedTextNodeIds]
  );

  const handleTextNodeContextMenu = useCallback(
    (id: string, clientX: number, clientY: number) => {
      closeContextMenu();
      setSelectedPathIds([]);
      setSelectedTextNodeIds([id]);
      setTextContextMenu({ id, x: clientX, y: clientY });
    },
    [closeContextMenu]
  );

  useEffect(() => {
    const handleCopyPasteKeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (isEditableTarget(event.target)) return;
      if (key === 'backspace') {
        if (cutSelection()) {
          event.preventDefault();
      }
      }
      if (!event.metaKey && !event.ctrlKey) return;
      
      if (key === 'c') {
        if (copySelection()) {
          event.preventDefault();
        }
      } else if (key === 'v') {
        if (pasteFromBuffer()) {
          event.preventDefault();
        }
      } else if (key === 'x') {
        if (cutSelection()) {
          event.preventDefault();
        }
      } else if (key === 'l') {
        if (event.shiftKey) {
          if (unlockSelection() && updateSelectionLockState(false)) {
            event.preventDefault();
          }
        } else if (lockSelection() && updateSelectionLockState(true)) {
            event.preventDefault();
          }
      } else if (key === 'l' && event.shiftKey) {
        if (unlockSelection()) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleCopyPasteKeys);
    return () => window.removeEventListener('keydown', handleCopyPasteKeys);
  }, [copySelection, pasteFromBuffer]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };
    const handleDismiss = () => closeContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    if (!textContextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (textContextMenuRef.current?.contains(event.target as Node)) return;
      closeTextContextMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTextContextMenu();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', closeTextContextMenu, true);
    window.addEventListener('resize', closeTextContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', closeTextContextMenu, true);
      window.removeEventListener('resize', closeTextContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTextContextMenu, textContextMenu]);

  const canUseCurveHandles =
    !!selectedPath &&
    selectedPath.pathKind === 'curve' &&
    selectedPath.curve &&
    (isCursorToolActive || isCurveLiveEditing);
  const effectiveMode: CanvasMode = spacePressed ? 'pan' : mode;

  const getLocalPoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0)
    };
  }, []);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const local = getLocalPoint(clientX, clientY);
      return {
        x: (local.x - camera.x) / camera.scale,
        y: (local.y - camera.y) / camera.scale
      };
    },
    [camera, getLocalPoint]
  );

  const worldToScreen = useCallback(
    (point: WorldPoint) => ({
      x: camera.x + point.x * camera.scale,
      y: camera.y + point.y * camera.scale
    }),
    [camera]
  );

  const maxZoom = viewportSize.width > 0 && viewportSize.width <= 720 ? 1 : MAX_ZOOM;
  const clampZoom = (scale: number) =>
    Math.min(Math.max(scale, MIN_ZOOM), maxZoom);

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
    if (camera.scale <= maxZoom) return;
    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const worldX = (center.x - camera.x) / camera.scale;
    const worldY = (center.y - camera.y) / camera.scale;
    const newX = center.x - worldX * maxZoom;
    const newY = center.y - worldY * maxZoom;
    setCamera(current => ({
      x: newX,
      y: newY,
      scale: Math.min(current.scale, maxZoom)
    }));
  }, [camera.scale, camera.x, camera.y, maxZoom, setCamera, viewportSize.height, viewportSize.width]);

const captureSelectionTargets = (pathsToCapture: CanvasPath[]): SelectionTargetSnapshot[] =>
  pathsToCapture.map(path => ({
    pathId: path.id,
    originalPoints: path.points.map(point => ({ ...point })),
    originalMasks: cloneMasks(path.eraserMasks),
    originalCurve: cloneCurve(path.curve)
  }));

const captureTextSelectionTargets = (
  nodes: CanvasTextNode[],
  includeLockedIds?: Set<string>
): TextSelectionTarget[] =>
  nodes
    .filter(node => includeLockedIds?.has(node.id) || !node.locked)
    .map(node => ({
      id: node.id,
      originX: node.x,
      originY: node.y,
      ignoreLock: includeLockedIds?.has(node.id)
    }));

  const getPathsBoundingBox = (pathsToMeasure: CanvasPath[]): BoundingBox | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasBounds = false;
    pathsToMeasure.forEach(path => {
      const bounds = getPathBoundingBox(path);
      if (!bounds) return;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
      hasBounds = true;
    });
    if (!hasBounds || !Number.isFinite(minX) || !Number.isFinite(minY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  };

  const beginSelectionMove = (
    pathsToMove: CanvasPath[],
    pointerId: number,
    worldPoint: WorldPoint,
    textNodesToMove: CanvasTextNode[] = [],
    forcedTextNodeIds?: Set<string>
  ) => {
    const movablePaths = pathsToMove.filter(path => !path.locked);
    const movableTextTargets = captureTextSelectionTargets(textNodesToMove, forcedTextNodeIds);
    if (!movablePaths.length && !movableTextTargets.length) return;
    selectionInteraction.current = {
      type: 'move',
      pointerId,
      origin: worldPoint,
      hasMutated: false,
      targets: captureSelectionTargets(movablePaths),
      textTargets: movableTextTargets
    };
    containerRef.current?.setPointerCapture(pointerId);
  };

  const beginSelectionScale = (
    pathsToScale: CanvasPath[],
    handle: SelectionHandle,
    pointerId: number
  ) => {
    const scalablePaths = pathsToScale.filter(path => !path.locked);
    if (!scalablePaths.length) return;
    const bounds = getPathsBoundingBox(scalablePaths);
    if (!bounds) return;
    selectionInteraction.current = {
      type: 'scale',
      pointerId,
      handle,
      originBox: bounds,
      minSize: 8 / camera.scale,
      hasMutated: false,
      targets: captureSelectionTargets(scalablePaths)
    };
    containerRef.current?.setPointerCapture(pointerId);
  };

  const beginSelectionRotate = (
    pathsToRotate: CanvasPath[],
    pointerId: number,
    worldPoint: WorldPoint
  ) => {
    const rotatablePaths = pathsToRotate.filter(path => !path.locked);
    if (!rotatablePaths.length) return;
    const bounds = getPathsBoundingBox(rotatablePaths);
    if (!bounds) return;
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    };
    const startAngle = Math.atan2(worldPoint.y - center.y, worldPoint.x - center.x);
    selectionInteraction.current = {
      type: 'rotate',
      pointerId,
      center,
      startAngle,
      hasMutated: false,
      targets: captureSelectionTargets(rotatablePaths)
    };
    containerRef.current?.setPointerCapture(pointerId);
  };

  const updateSelectionInteraction = (worldPoint: WorldPoint) => {
    const interaction = selectionInteraction.current;
    if (!interaction) return;
    if (interaction.type === 'move') {
      const deltaX = worldPoint.x - interaction.origin.x;
      const deltaY = worldPoint.y - interaction.origin.y;
      if (deltaX === 0 && deltaY === 0) return;
      if (!interaction.hasMutated) {
        onBeginPath?.();
        interaction.hasMutated = true;
      }
      const targetMap = new Map(interaction.targets.map(target => [target.pathId, target]));
      setPaths(prev =>
        prev.map(path => {
          const target = targetMap.get(path.id);
          if (!target) return path;
          let nextCurve = path.curve;
          let nextPoints = target.originalPoints.map(point => ({
            x: point.x + deltaX,
            y: point.y + deltaY
          }));
          if (path.pathKind === 'curve' && target.originalCurve) {
            nextCurve = translateCurve(target.originalCurve, deltaX, deltaY);
            nextPoints = generateCurvePoints(nextCurve);
          }
          return {
            ...path,
            points: nextPoints,
            curve: nextCurve,
            eraserMasks: target.originalMasks.length
              ? translateMasks(target.originalMasks, deltaX, deltaY)
              : path.eraserMasks
          };
        })
      );
      if (interaction.textTargets.length) {
        interaction.textTargets.forEach(target => {
          onMoveTextNode(target.id, target.originX + deltaX, target.originY + deltaY);
        });
      }
      return;
    }
    if (interaction.type === 'rotate') {
      const vectorX = worldPoint.x - interaction.center.x;
      const vectorY = worldPoint.y - interaction.center.y;
      const magnitude = Math.hypot(vectorX, vectorY);
      if (magnitude < 1e-4) return;
      const newAngle = Math.atan2(vectorY, vectorX);
      const deltaAngle = newAngle - interaction.startAngle;
      if (!Number.isFinite(deltaAngle) || Math.abs(deltaAngle) < 1e-4) return;
      if (!interaction.hasMutated) {
        onBeginPath?.();
        interaction.hasMutated = true;
      }
      const cos = Math.cos(deltaAngle);
      const sin = Math.sin(deltaAngle);
      const targetMap = new Map(interaction.targets.map(target => [target.pathId, target]));
      setPaths(prev =>
        prev.map(path => {
          const target = targetMap.get(path.id);
          if (!target) return path;
          let nextCurve = path.curve;
          let nextPoints = target.originalPoints.map(point => {
            const relX = point.x - interaction.center.x;
            const relY = point.y - interaction.center.y;
            return {
              x: interaction.center.x + relX * cos - relY * sin,
              y: interaction.center.y + relX * sin + relY * cos
            };
          });
          if (path.pathKind === 'curve' && target.originalCurve) {
            nextCurve = rotateCurve(target.originalCurve, interaction.center, cos, sin);
            nextPoints = generateCurvePoints(nextCurve);
          }
          return {
            ...path,
            points: nextPoints,
            curve: nextCurve,
            eraserMasks: target.originalMasks.length
              ? rotateMasks(target.originalMasks, interaction.center, cos, sin)
              : path.eraserMasks
          };
        })
      );
      return;
    }
    const { originBox, handle, minSize } = interaction;
    let newMinX = originBox.minX;
    let newMaxX = originBox.maxX;
    let newMinY = originBox.minY;
    let newMaxY = originBox.maxY;
    switch (handle) {
      case 'n':
        newMinY = Math.min(worldPoint.y, originBox.maxY - minSize);
        break;
      case 's':
        newMaxY = Math.max(worldPoint.y, originBox.minY + minSize);
        break;
      case 'w':
        newMinX = Math.min(worldPoint.x, originBox.maxX - minSize);
        break;
      case 'e':
        newMaxX = Math.max(worldPoint.x, originBox.minX + minSize);
        break;
      case 'nw':
        newMinX = Math.min(worldPoint.x, originBox.maxX - minSize);
        newMinY = Math.min(worldPoint.y, originBox.maxY - minSize);
        break;
      case 'ne':
        newMaxX = Math.max(worldPoint.x, originBox.minX + minSize);
        newMinY = Math.min(worldPoint.y, originBox.maxY - minSize);
        break;
      case 'sw':
        newMinX = Math.min(worldPoint.x, originBox.maxX - minSize);
        newMaxY = Math.max(worldPoint.y, originBox.minY + minSize);
        break;
      case 'se':
        newMaxX = Math.max(worldPoint.x, originBox.minX + minSize);
        newMaxY = Math.max(worldPoint.y, originBox.minY + minSize);
        break;
      default:
        break;
    }

    if (
      newMinX === originBox.minX &&
      newMaxX === originBox.maxX &&
      newMinY === originBox.minY &&
      newMaxY === originBox.maxY
    ) {
      return;
    }

    if (!interaction.hasMutated) {
      onBeginPath?.();
      interaction.hasMutated = true;
    }

    const originalWidth = Math.max(originBox.maxX - originBox.minX, 1e-3);
    const originalHeight = Math.max(originBox.maxY - originBox.minY, 1e-3);
    const newWidth = Math.max(newMaxX - newMinX, 1e-3);
    const newHeight = Math.max(newMaxY - newMinY, 1e-3);

    const targetMap = new Map(interaction.targets.map(target => [target.pathId, target]));
    setPaths(prev =>
      prev.map(path => {
        const target = targetMap.get(path.id);
        if (!target) return path;
        let nextCurve = path.curve;
        let nextPoints = target.originalPoints.map(point => {
          const relX = (point.x - originBox.minX) / originalWidth;
          const relY = (point.y - originBox.minY) / originalHeight;
          return {
            x: newMinX + relX * newWidth,
            y: newMinY + relY * newHeight
          };
        });
        if (path.pathKind === 'curve' && target.originalCurve) {
          nextCurve = scaleCurve(
            target.originalCurve,
            originBox,
            originalWidth,
            originalHeight,
            newMinX,
            newMinY,
            newWidth,
            newHeight
          );
          nextPoints = generateCurvePoints(nextCurve);
        }
        return {
          ...path,
          points: nextPoints,
          curve: nextCurve,
          eraserMasks: target.originalMasks.length
            ? scaleMasks(
                target.originalMasks,
                originBox,
                originalWidth,
                originalHeight,
                newMinX,
                newMinY,
                newWidth,
                newHeight
              )
            : path.eraserMasks
        };
      })
    );
  };

  const endSelectionInteraction = () => {
    selectionInteraction.current = null;
  };

  const beginMarqueeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const local = getLocalPoint(event.clientX, event.clientY);
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    marqueeInteraction.current = {
      pointerId: event.pointerId,
      originLocal: local,
      originWorld: worldPoint,
      currentLocal: local,
      currentWorld: worldPoint,
      additive: event.shiftKey
    };
    setMarqueeRect({
      left: local.x,
      top: local.y,
      width: 0,
      height: 0
    });
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const updateMarqueeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = marqueeInteraction.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    const local = getLocalPoint(event.clientX, event.clientY);
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    interaction.currentLocal = local;
    interaction.currentWorld = worldPoint;
    const left = Math.min(interaction.originLocal.x, local.x);
    const top = Math.min(interaction.originLocal.y, local.y);
    const width = Math.abs(local.x - interaction.originLocal.x);
    const height = Math.abs(local.y - interaction.originLocal.y);
    setMarqueeRect({
      left,
      top,
      width,
      height
    });
  };

  const finalizeMarqueeSelection = () => {
    const interaction = marqueeInteraction.current;
    if (!interaction) return;
    marqueeInteraction.current = null;
    setMarqueeRect(null);
    const minX = Math.min(interaction.originWorld.x, interaction.currentWorld.x);
    const minY = Math.min(interaction.originWorld.y, interaction.currentWorld.y);
    const maxX = Math.max(interaction.originWorld.x, interaction.currentWorld.x);
    const maxY = Math.max(interaction.originWorld.y, interaction.currentWorld.y);
    const selectedIds = paths
      .filter(path => path.color !== 'erase')
      .filter(path => {
        const bounds = getPathBoundingBox(path);
        if (!bounds) return false;
        return (
          bounds.maxX >= minX &&
          bounds.minX <= maxX &&
          bounds.maxY >= minY &&
          bounds.minY <= maxY
        );
      })
      .map(path => path.id);

    const selectedTextIds = textNodes
      .filter(node => {
        const { width, height } = getTextNodeSize(node);
        const nodeMinX = node.x;
        const nodeMinY = node.y;
        const nodeMaxX = node.x + width;
        const nodeMaxY = node.y + height;
        return nodeMaxX >= minX && nodeMinX <= maxX && nodeMaxY >= minY && nodeMinY <= maxY;
      })
      .map(node => node.id);

    if (!selectedIds.length && !selectedTextIds.length) {
      if (!interaction.additive) {
        setSelectedPathIds([]);
        clearTextNodeSelection();
      }
      return;
    }

    if (selectedIds.length) {
      addPathsToSelection(selectedIds, interaction.additive);
    } else if (!interaction.additive) {
      setSelectedPathIds([]);
    }

    if (selectedTextIds.length) {
      addTextNodesToSelection(selectedTextIds, interaction.additive);
    } else if (!interaction.additive) {
      clearTextNodeSelection();
    }
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    panOrigin.current = {
      x: event.clientX,
      y: event.clientY,
      camX: camera.x,
      camY: camera.y
    };
    setIsPanning(true);
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    onBeginPath?.();
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    const { width, color, opacity } = getStrokeStyle();
    onStrokeColorUsed?.(color);
    const usingShape = shapeTool !== 'freeform';
    const isCurveShape = shapeTool === 'curve';
    const isClosedShape = usingShape && !OPEN_SHAPES.includes(shapeTool);
    let newPath: CanvasPath;
    if (isCurveShape) {
      const baseCurve = createCurveFromPoints(worldPoint, worldPoint);
      curveDraftRef.current = baseCurve;
      newPath = {
        id: crypto.randomUUID(),
        color,
        width,
        opacity,
        points: generateCurvePoints(baseCurve),
        startCap: 'round',
        endCap: 'round',
        eraserMasks: [],
        pathKind: 'curve',
        curve: baseCurve,
        shapeType: 'curve'
      };
      shapeOrigin.current = null;
      activeShapeTool.current = 'curve';
    } else {
      curveDraftRef.current = null;
      const initialPoints = usingShape
        ? getShapePoints(shapeTool, worldPoint, worldPoint)
        : [worldPoint];
      newPath = {
        id: crypto.randomUUID(),
        color,
        width,
        opacity,
        points: initialPoints,
        startCap: usingShape ? 'butt' : 'round',
        endCap: usingShape ? 'butt' : 'round',
        eraserMasks: [],
        isClosed: isClosedShape,
        pathKind: 'freehand',
        shapeType: usingShape ? shapeTool : 'freeform'
      };
      if (usingShape) {
        shapeOrigin.current = worldPoint;
        activeShapeTool.current = shapeTool;
      } else {
        shapeOrigin.current = null;
        activeShapeTool.current = 'freeform';
      }
    }
    activePathId.current = newPath.id;
    activePointerId.current = event.pointerId;
    currentAction.current = isCurveShape ? 'curve' : 'draw';
    containerRef.current?.setPointerCapture(event.pointerId);
    setPaths(prev => [...prev, newPath]);
  };

  const beginErase = (event: ReactPointerEvent<HTMLDivElement>) => {
    onBeginPath?.();
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    const { width } = getStrokeStyle();
    const newPath: CanvasPath = {
      id: crypto.randomUUID(),
      color: 'erase',
      width,
      opacity: 0.6,
      points: [worldPoint],
      startCap: 'round',
      endCap: 'round'
    };
    activePathId.current = newPath.id;
    activePointerId.current = event.pointerId;
    currentAction.current = 'erase';
    containerRef.current?.setPointerCapture(event.pointerId);
    setPaths(prev => [...prev, newPath]);
  };

  const updatePath = useCallback(
    (point: WorldPoint) => {
      const targetId = activePathId.current;
      if (!targetId) return;
      if (currentAction.current === 'curve' && curveDraftRef.current) {
        const startPoint =
          curveDraftRef.current.nodes[0]?.anchor ?? point;
        const nextCurve = createCurveFromPoints(startPoint, point);
        curveDraftRef.current = nextCurve;
        setPaths(prev =>
          prev.map(path =>
            path.id === targetId
              ? {
                  ...path,
                  curve: nextCurve,
                  points: generateCurvePoints(nextCurve)
                }
              : path
          )
        );
        return;
      }
      if (activeShapeTool.current !== 'freeform' && shapeOrigin.current) {
        const origin = shapeOrigin.current;
        const nextPoints = getShapePoints(activeShapeTool.current, origin, point);
        setPaths(prev =>
          prev.map(path =>
            path.id === targetId
              ? { ...path, points: nextPoints }
              : path
          )
        );
        return;
      }
      setPaths(prev =>
        prev.map(path =>
          path.id === targetId
            ? { ...path, points: [...path.points, point] }
            : path
        )
      );
    },
    [setPaths]
  );

  const finalizeEraserStroke = () => {
    const eraserId = activePathId.current;
    if (!eraserId) return;
    setPaths(prev => {
      const eraserPath = prev.find(path => path.id === eraserId && path.color === 'erase');
      if (!eraserPath) {
        return prev.filter(path => path.id !== eraserId);
      }
      const remaining = prev.filter(path => path.id !== eraserId);
      if (eraserPath.points.length === 0) {
        return remaining;
      }
      const radius = Math.max(eraserPath.width / 2, 2);
      const step = Math.max(radius * 0.5, 1);
      const samples = sampleStrokePoints(eraserPath.points, step);
      return remaining.map(path => {
        if (path.color === 'erase') return path;
        if (!doesMaskAffectPath(path, samples, radius)) return path;
        const mask: CanvasMask = {
          id: crypto.randomUUID(),
          width: eraserPath.width,
          points: eraserPath.points.map(point => ({ ...point }))
        };
        const nextMasks = path.eraserMasks ? [...path.eraserMasks, mask] : [mask];
        return { ...path, eraserMasks: nextMasks };
      });
    });
  };

  const applyCurveHandleUpdate = (worldPoint: WorldPoint) => {
    const interaction = curveHandleInteraction.current;
    if (!interaction || interaction.stage !== 'active') return;
    const baseCurve = interaction.originCurve;
    if (!baseCurve) return;
    const adjustedPoint = {
      x: worldPoint.x - interaction.grabOffset.x,
      y: worldPoint.y - interaction.grabOffset.y
    };
    const nextCurve = cloneCurve(baseCurve);
    if (!nextCurve) return;
    const nodeIndex = interaction.handle.nodeIndex;
    const node = nextCurve.nodes[nodeIndex];
    const originNode = baseCurve.nodes[nodeIndex];
    if (!node || !originNode) return;
    let didChange = false;
    if (interaction.handle.kind === 'anchor') {
      const deltaX = adjustedPoint.x - originNode.anchor.x;
      const deltaY = adjustedPoint.y - originNode.anchor.y;
      if (deltaX === 0 && deltaY === 0) return;
      node.anchor = adjustedPoint;
      if (originNode.handleIn) {
        node.handleIn = {
          x: originNode.handleIn.x + deltaX,
          y: originNode.handleIn.y + deltaY
        };
      }
      if (originNode.handleOut) {
        node.handleOut = {
          x: originNode.handleOut.x + deltaX,
          y: originNode.handleOut.y + deltaY
        };
      }
      didChange = true;
    } else if (interaction.handle.kind === 'handleIn') {
      const prev = originNode.handleIn ?? originNode.anchor;
      if (prev.x === adjustedPoint.x && prev.y === adjustedPoint.y) return;
      node.handleIn = { ...adjustedPoint };
      didChange = true;
    } else if (interaction.handle.kind === 'handleOut') {
      const prev = originNode.handleOut ?? originNode.anchor;
      if (prev.x === adjustedPoint.x && prev.y === adjustedPoint.y) return;
      node.handleOut = { ...adjustedPoint };
      didChange = true;
    }
    if (!didChange) return;
    if (!interaction.hasMutated) {
      onBeginPath?.();
      interaction.hasMutated = true;
    }
    setPaths(prev =>
      prev.map(path =>
        path.id === interaction.pathId
          ? {
              ...path,
              curve: nextCurve,
              points: generateCurvePoints(nextCurve)
            }
          : path
      )
    );
  };

  const startCurveDragFromPoint = (
    path: CanvasPath,
    handle: CurveHandleDescriptor,
    worldPoint: WorldPoint,
    pointerId: number
  ) => {
    if (!path.curve) return false;
    const baseCurve = cloneCurve(path.curve);
    if (!baseCurve) return false;
    const handlePoint = getCurveHandlePoint(baseCurve, handle);
    const grabOffset = {
      x: worldPoint.x - handlePoint.x,
      y: worldPoint.y - handlePoint.y
    };
    curveHandleInteraction.current = {
      handle,
      pointerId,
      pathId: path.id,
      originCurve: baseCurve,
      grabOffset,
      stage: 'active',
      hasMutated: false
    };
    containerRef.current?.setPointerCapture(pointerId);
    return true;
  };

  const endDraw = () => {
    activePathId.current = null;
    activePointerId.current = null;
    currentAction.current = null;
    shapeOrigin.current = null;
    activeShapeTool.current = 'freeform';
    curveDraftRef.current = null;
  };

  const beginImagePlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startPoint = screenToWorld(event.clientX, event.clientY);
    imagePlacementInteraction.current = {
      pointerId: event.pointerId,
      start: startPoint
    };
    setImageDraftRect({
      x: startPoint.x,
      y: startPoint.y,
      width: 0,
      height: 0
    });
    containerRef.current?.setPointerCapture(event.pointerId);
  };

  const updateImagePlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = imagePlacementInteraction.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const currentPoint = screenToWorld(event.clientX, event.clientY);
    setImageDraftRect({
      x: Math.min(interaction.start.x, currentPoint.x),
      y: Math.min(interaction.start.y, currentPoint.y),
      width: Math.abs(currentPoint.x - interaction.start.x),
      height: Math.abs(currentPoint.y - interaction.start.y)
    });
  };

  const finalizeImagePlacement = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const interaction = imagePlacementInteraction.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return false;
    containerRef.current?.releasePointerCapture(event.pointerId);
    imagePlacementInteraction.current = null;
    const currentPoint = screenToWorld(event.clientX, event.clientY);
    const deltaX = Math.abs(currentPoint.x - interaction.start.x);
    const deltaY = Math.abs(currentPoint.y - interaction.start.y);
    setImageDraftRect(null);
    if (cancel) {
      onImageDrawCancel?.();
      return true;
    }
    const dragThreshold = Math.max(6 / camera.scale, 2);
    let rect: ImagePlacement;
    if (deltaX < dragThreshold && deltaY < dragThreshold) {
      rect = {
        x: interaction.start.x - IMAGE_FALLBACK_WIDTH / 2,
        y: interaction.start.y - IMAGE_FALLBACK_HEIGHT / 2,
        width: IMAGE_FALLBACK_WIDTH,
        height: IMAGE_FALLBACK_HEIGHT
      };
    } else {
      rect = {
        x: Math.min(interaction.start.x, currentPoint.x),
        y: Math.min(interaction.start.y, currentPoint.y),
        width: Math.max(deltaX, 1),
        height: Math.max(deltaY, 1)
      };
    }
    onImageDrawComplete(rect);
    return true;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, getLocalPoint(event.clientX, event.clientY));
      const points = getTouchPointsArray();
      if (points.length >= 2) {
        if (activePointerId.current !== null && currentAction.current) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        maybeStartTouchGesture(points, true);
        return;
      }
    }

    blurActiveTextNodeInput();
    if (!event.shiftKey) {
      clearTextNodeSelection();
    }

    if (event.button === 2) return; // ignore context menu button

    if (
      event.pointerType === 'touch' &&
      mode === 'draw' &&
      drawTool !== 'cursor' &&
      drawTool !== 'text' &&
      drawTool !== 'textbox' &&
      drawTool !== 'image' &&
      event.button === 0
    ) {
      event.preventDefault();
      if (drawTool === 'eraser') {
        beginErase(event);
      } else {
        beginDraw(event);
      }
      return;
    }

    const pendingCurveHandle = curveHandleInteraction.current;
    if (
      pendingCurveHandle &&
      pendingCurveHandle.pointerId === event.pointerId &&
      pendingCurveHandle.stage === 'pending'
    ) {
      if (
        canUseCurveHandles &&
        selectedPath &&
        selectedPath.id === pendingCurveHandle.pathId &&
        selectedPath.pathKind === 'curve'
      ) {
        event.preventDefault();
        curveHandleInteraction.current = {
          ...pendingCurveHandle,
          stage: 'active'
        };
        containerRef.current?.setPointerCapture(event.pointerId);
      } else {
        curveHandleInteraction.current = null;
      }
      return;
    }

    if (!isCursorToolActive && isCurveLiveEditing && selectedPath?.pathKind === 'curve') {
      if (event.button !== 0) return;
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      const threshold = Math.max(18 / camera.scale, selectedPath.width * 1.1);
      const nearestHandle =
        selectedPath.curve && findNearestCurveHandle(selectedPath.curve, worldPoint, threshold);
      if (nearestHandle && selectedPath.curve) {
        startCurveDragFromPoint(selectedPath, nearestHandle, worldPoint, event.pointerId);
      } else if (selectedPath.curve) {
        const distance = getPointToPathDistance(selectedPath, worldPoint);
        if (distance <= threshold * 1.5) {
          const { curve: insertedCurve, insertedIndex } = insertCurveNodeAtPoint(
            selectedPath.curve,
            worldPoint
          );
          setPaths(prev =>
            prev.map(path =>
              path.id === selectedPath.id
                ? {
                    ...path,
                    curve: insertedCurve,
                    points: generateCurvePoints(insertedCurve)
                  }
                : path
            )
          );
          const descriptor: CurveHandleDescriptor = { kind: 'anchor', nodeIndex: insertedIndex };
          startCurveDragFromPoint(
            {
              ...selectedPath,
              curve: insertedCurve
            },
            descriptor,
            worldPoint,
            event.pointerId
          );
        } else {
          finalizeLiveCurveEditing();
        }
      }
      return;
    }

    if (effectiveMode === 'pan' || event.button === 1) {
      beginPan(event);
      return;
    }

    if (isCursorToolActive && effectiveMode === 'draw') {
      if (event.button !== 0) return;
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      const pendingHandle = pendingHandleInteraction.current;
      if (
        pendingHandle &&
        pendingHandle.pointerId === event.pointerId &&
        selectedPaths.length
      ) {
        if (pendingHandle.type === 'scale') {
          beginSelectionScale(selectedPaths, pendingHandle.handle, event.pointerId);
        } else {
          beginSelectionRotate(selectedPaths, event.pointerId, worldPoint);
        }
        pendingHandleInteraction.current = null;
        return;
      }
      pendingHandleInteraction.current = null;
      const hitPath = hitTestPaths(worldPoint);
      if (event.shiftKey) {
        if (hitPath) {
          togglePathSelection(hitPath.id);
        } else {
          beginMarqueeSelection(event);
        }
        return;
      }
      if (hitPath) {
        const pathAlreadySelected = selectedPathIds.includes(hitPath.id);
        let pathsToMove: CanvasPath[] = [hitPath];
        if (pathAlreadySelected && selectedPathIds.length > 1) {
          if (selectedPaths.length) {
            pathsToMove = selectedPaths;
          }
        } else if (!pathAlreadySelected) {
          setSelectedPathIds([hitPath.id]);
        }
        const attachedNodes = getAttachedTextNodesForPaths(pathsToMove);
        const mergedTextNodes = [...selectedTextNodes];
        let forcedIds: Set<string> | undefined;
        if (attachedNodes.length) {
          const existingIds = new Set(mergedTextNodes.map(node => node.id));
          attachedNodes.forEach(node => {
            if (!existingIds.has(node.id)) {
              mergedTextNodes.push(node);
            }
          });
          forcedIds = new Set(attachedNodes.map(node => node.id));
        }
        beginSelectionMove(pathsToMove, event.pointerId, worldPoint, mergedTextNodes, forcedIds);
      } else {
        setSelectedPathIds([]);
        beginPan(event);
      }
      return;
    }

    if (
      mode === 'draw' &&
      drawTool !== 'cursor' &&
      drawTool !== 'text' &&
      drawTool !== 'textbox' &&
      drawTool !== 'image' &&
      event.button === 0
    ) {
      event.preventDefault();
      if (drawTool === 'eraser') {
        beginErase(event);
      } else {
        beginDraw(event);
      }
      return;
    }

    if (mode === 'draw' && imageToolActive && event.button === 0) {
      event.preventDefault();
      beginImagePlacement(event);
      return;
    }

    if (
      mode === 'draw' &&
      (drawTool === 'text' || drawTool === 'textbox') &&
      event.button === 0
    ) {
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      const kind = drawTool === 'textbox' ? 'textbox' : 'sticky';
      if (kind === 'textbox') {
        worldPoint.y -= TEXTBOX_PLACEMENT_OFFSET_Y / camera.scale;
        worldPoint.x -= TEXTBOX_PLACEMENT_OFFSET_X / camera.scale;
      }
      onRequestTextNode(worldPoint, kind);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, getLocalPoint(event.clientX, event.clientY));
      if (touchGesture.current) {
        event.preventDefault();
        updateTouchGesture();
        return;
      }
    }

    const activeCurveHandle = curveHandleInteraction.current;
    if (
      activeCurveHandle &&
      activeCurveHandle.pointerId === event.pointerId &&
      activeCurveHandle.stage === 'active'
    ) {
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      applyCurveHandleUpdate(worldPoint);
      return;
    }

    const activeMarquee = marqueeInteraction.current;
    if (activeMarquee && event.pointerId === activeMarquee.pointerId) {
      event.preventDefault();
      updateMarqueeSelection(event);
      return;
    }

    const selectionActive = selectionInteraction.current;
    if (selectionActive && event.pointerId === selectionActive.pointerId) {
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      updateSelectionInteraction(worldPoint);
      return;
    }

    if (
      imageToolActive &&
      imagePlacementInteraction.current &&
      imagePlacementInteraction.current.pointerId === event.pointerId
    ) {
      event.preventDefault();
      updateImagePlacement(event);
      return;
    }

    if (isPanning) {
      event.preventDefault();
      const deltaX = event.clientX - panOrigin.current.x;
      const deltaY = event.clientY - panOrigin.current.y;
      setCamera({
        x: panOrigin.current.camX + deltaX,
        y: panOrigin.current.camY + deltaY,
        scale: camera.scale
      });
      return;
    }

    if (activePointerId.current !== null && event.pointerId === activePointerId.current) {
      event.preventDefault();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      updatePath(worldPoint);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPoints.current.delete(event.pointerId);
      const remainingPoints = getTouchPointsArray();
      touchGesture.current = null;
      if (remainingPoints.length >= 2) {
        maybeStartTouchGesture(remainingPoints, false);
      }
    }

    if (pendingHandleInteraction.current?.pointerId === event.pointerId) {
      pendingHandleInteraction.current = null;
    }

    if (
      imagePlacementInteraction.current &&
      event.pointerId === imagePlacementInteraction.current.pointerId
    ) {
      finalizeImagePlacement(event);
      return;
    }

    if (
      curveHandleInteraction.current &&
      event.pointerId === curveHandleInteraction.current.pointerId
    ) {
      if (curveHandleInteraction.current.stage === 'active') {
        containerRef.current?.releasePointerCapture(event.pointerId);
      }
      curveHandleInteraction.current = null;
      return;
    }

    if (marqueeInteraction.current && event.pointerId === marqueeInteraction.current.pointerId) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      finalizeMarqueeSelection();
      return;
    }

    if (isPanning && containerRef.current) {
      containerRef.current.releasePointerCapture(event.pointerId);
      setIsPanning(false);
      return;
    }

    if (selectionInteraction.current && event.pointerId === selectionInteraction.current.pointerId) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      endSelectionInteraction();
      return;
    }

    if (activePointerId.current !== null && event.pointerId === activePointerId.current) {
      const finishedPathId = activePathId.current;
      const finishedShapeTool = activeShapeTool.current;
      const wasCurveCreation = currentAction.current === 'curve';
      const wasErase = currentAction.current === 'erase';
      containerRef.current?.releasePointerCapture(event.pointerId);
      if (wasErase) {
        finalizeEraserStroke();
      }
      endDraw();
      if (wasCurveCreation && finishedPathId) {
        setLiveCurveEditPathId(finishedPathId);
        setSelectedPathIds([finishedPathId]);
      }
      if (finishedPathId) {
        addGraphLabelsForPath(finishedShapeTool, finishedPathId);
      }
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPoints.current.delete(event.pointerId);
      if (touchPoints.current.size < 2) {
        touchGesture.current = null;
      }
      return;
    }

    if (
      imagePlacementInteraction.current &&
      event.pointerId === imagePlacementInteraction.current.pointerId
    ) {
      finalizeImagePlacement(event, true);
    }

    if (isPanning) {
      setIsPanning(false);
    }
    if (
      marqueeInteraction.current &&
      event.pointerId === marqueeInteraction.current.pointerId
    ) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      finalizeMarqueeSelection();
    }
    if (
      selectionInteraction.current &&
      event.pointerId === selectionInteraction.current.pointerId
    ) {
      containerRef.current?.releasePointerCapture(event.pointerId);
      endSelectionInteraction();
    }
    if (
      curveHandleInteraction.current &&
      event.pointerId === curveHandleInteraction.current.pointerId
    ) {
      if (curveHandleInteraction.current.stage === 'active') {
        containerRef.current?.releasePointerCapture(event.pointerId);
      }
      curveHandleInteraction.current = null;
    }
    pendingHandleInteraction.current = null;
    if (activePointerId.current !== null) {
      const finishedPathId = activePathId.current;
      const wasCurveCreation = currentAction.current === 'curve';
      if (currentAction.current === 'erase') {
        finalizeEraserStroke();
      }
      endDraw();
      if (wasCurveCreation && finishedPathId) {
        setLiveCurveEditPathId(finishedPathId);
        setSelectedPathIds([finishedPathId]);
      }
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      imagePlacementInteraction.current &&
      event.pointerId === imagePlacementInteraction.current.pointerId
    ) {
      finalizeImagePlacement(event, true);
      return;
    }
    handlePointerUp(event);
  };

  const handleSelectionHandlePointerDown = (handle: SelectionHandle) => (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!isCursorToolActive || !hasSelection) return;
    event.preventDefault();
    pendingHandleInteraction.current = { type: 'scale', handle, pointerId: event.pointerId };
  };

  const handleRotationHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isCursorToolActive || !hasSelection) return;
    event.preventDefault();
    pendingHandleInteraction.current = { type: 'rotate', pointerId: event.pointerId };
  };

  const handleCurveHandlePointerDown = (handle: CurveHandleDescriptor) => (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!canUseCurveHandles || !selectedPath?.curve) {
      return;
    }
    event.preventDefault();
    const worldPoint = screenToWorld(event.clientX, event.clientY);
    const targetPoint = getCurveHandlePoint(selectedPath.curve, handle);
    const grabOffset = {
      x: worldPoint.x - targetPoint.x,
      y: worldPoint.y - targetPoint.y
    };
    const baseCurve = cloneCurve(selectedPath.curve);
    if (!baseCurve) return;
    curveHandleInteraction.current = {
      handle,
      pointerId: event.pointerId,
      pathId: selectedPath.id,
      originCurve: baseCurve,
      grabOffset,
      stage: 'pending',
      hasMutated: false
    };
  };

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        const zoomIntensity = 0.0015;
        const delta = -event.deltaY * zoomIntensity;
        if (delta === 0) return;

        setCamera(currentCamera => {
          const newScale = clampZoom(currentCamera.scale * (1 + delta));
          const local = getLocalPoint(event.clientX, event.clientY);

          const worldX = (local.x - currentCamera.x) / currentCamera.scale;
          const worldY = (local.y - currentCamera.y) / currentCamera.scale;

          const newX = local.x - worldX * newScale;
          const newY = local.y - worldY * newScale;

          return {
            x: newX,
            y: newY,
            scale: newScale
          };
        });
        return;
      }

      setCamera(currentCamera => ({
        x: currentCamera.x - event.deltaX,
        y: currentCamera.y - event.deltaY,
        scale: currentCamera.scale
      }));
    },
    [getLocalPoint, setCamera]
  );

  const gridStyle = useMemo(() => {
    const size = GRID_SPACING * camera.scale;
    return {
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${camera.x % size}px ${camera.y % size}px`
    };
  }, [camera, getLocalPoint]);

  const selectionBox = useMemo(() => {
    if (!selectedPathIds.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasBounds = false;
    const selectedSet = new Set(selectedPathIds);
    paths.forEach(path => {
      if (!selectedSet.has(path.id)) return;
      const bounds = getPathBoundingBox(path);
      if (!bounds) return;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
      hasBounds = true;
    });
    if (!hasBounds) return null;
    const topLeft = worldToScreen({ x: minX, y: minY });
    const bottomRight = worldToScreen({ x: maxX, y: maxY });
    const left = Math.min(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const width = Math.max(Math.abs(bottomRight.x - topLeft.x), 4);
    const height = Math.max(Math.abs(bottomRight.y - topLeft.y), 4);
    return { left, top, width, height };
  }, [paths, selectedPathIds, worldToScreen]);

  const showSelectionBox = !!selectionBox && (isCursorToolActive || isCurveLiveEditing);
  const showCurveHandles = showSelectionBox && canUseCurveHandles;

  const hitTestPaths = useCallback(
    (worldPoint: WorldPoint) => {
      const threshold = 12 / camera.scale;
      for (let i = paths.length - 1; i >= 0; i -= 1) {
        const path = paths[i];
        if (path.color === 'erase') continue;
        const bounds = getPathBoundingBox(path);
        if (!bounds) continue;
        if (
          worldPoint.x < bounds.minX - threshold ||
          worldPoint.x > bounds.maxX + threshold ||
          worldPoint.y < bounds.minY - threshold ||
          worldPoint.y > bounds.maxY + threshold
        ) {
          continue;
        }
        const distance = getPointToPathDistance(path, worldPoint);
        if (distance <= threshold) {
          return path;
        }
      }
      return null;
    },
    [camera.scale, paths]
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
       closeTextContextMenu();
      const worldPoint = screenToWorld(event.clientX, event.clientY);
      const hitPath = hitTestPaths(worldPoint);
      if (hitPath && !selectedPathIds.includes(hitPath.id)) {
        setSelectedPathIds([hitPath.id]);
      } else if (!hitPath) {
        setSelectedPathIds([]);
      }
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [closeTextContextMenu, hitTestPaths, screenToWorld, selectedPathIds, setSelectedPathIds]
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewportSize.width === 0 && viewportSize.height === 0) return;
    onViewportSizeChange?.(viewportSize);
  }, [viewportSize, onViewportSizeChange]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const listener = (event: WheelEvent) => handleWheel(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => {
      element.removeEventListener('wheel', listener);
    };
  }, [handleWheel]);

  const drawPaths = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewportSize.width === 0 || viewportSize.height === 0) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixelRatio = window.devicePixelRatio ?? 1;
    const targetWidth = viewportSize.width * pixelRatio;
    const targetHeight = viewportSize.height * pixelRatio;
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.save();
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, viewportSize.width, viewportSize.height);
    context.lineJoin = 'round';

    const shouldSmoothPath = (target: CanvasPath) => {
      const startCap = target.startCap ?? 'round';
      const endCap = target.endCap ?? 'round';
      if (target.isClosed) return false;
      if (target.pathKind === 'curve') return false;
      if (startCap !== 'round' || endCap !== 'round') return false;
      return true;
    };

    const drawLinearPath = (points: WorldPoint[], closePath: boolean) => {
      if (!points.length) return;
      const first = worldToScreen(points[0]);
      context.moveTo(first.x, first.y);
      if (points.length === 1) {
        context.lineTo(first.x, first.y);
        if (closePath) {
          context.closePath();
        }
        return;
      }
      for (let i = 1; i < points.length; i += 1) {
        const screenPoint = worldToScreen(points[i]);
        context.lineTo(screenPoint.x, screenPoint.y);
      }
      if (closePath) {
        context.closePath();
      }
    };

    const drawSmoothPath = (points: WorldPoint[]) => {
      if (points.length < 3) {
        drawLinearPath(points, false);
        return;
      }
      const screenPoints = points.map(point => worldToScreen(point));
      context.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length - 2; i += 1) {
        const current = screenPoints[i];
        const next = screenPoints[i + 1];
        const midPointX = (current.x + next.x) / 2;
        const midPointY = (current.y + next.y) / 2;
        context.quadraticCurveTo(current.x, current.y, midPointX, midPointY);
      }
      const penultimate = screenPoints[screenPoints.length - 2];
      const last = screenPoints[screenPoints.length - 1];
      context.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
    };

    paths.forEach(path => {
      if (path.points.length === 0) return;
      if (path.color === 'erase' && !path.eraserMasks) {
        context.beginPath();
        const first = worldToScreen(path.points[0]);
        context.moveTo(first.x, first.y);
        for (let i = 1; i < path.points.length; i += 1) {
          const screenPoint = worldToScreen(path.points[i]);
          context.lineTo(screenPoint.x, screenPoint.y);
        }
        context.strokeStyle = path.color;
        context.globalAlpha = path.opacity ?? 1;
        context.globalCompositeOperation = 'destination-out';
        context.lineWidth = (path.width * camera.scale) + 4;
        context.lineCap = 'round';
        context.stroke();
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        return;
      }

      const startCap = path.startCap ?? 'round';
      const endCap = path.endCap ?? 'round';
      const strokeColor = path.color;
      const strokeAlpha = path.opacity ?? 1;
      const lineWidth = path.width * camera.scale;

      const drawCap = (capPosition: 'start' | 'end') => {
        const capType = capPosition === 'start' ? startCap : endCap;
        if (capType !== 'round') return;
        if (path.points.length < 2) return;
        const index = capPosition === 'start' ? 0 : path.points.length - 1;
        const neighborIndex =
          capPosition === 'start' ? Math.min(1, path.points.length - 1) : Math.max(path.points.length - 2, 0);
        if (index === neighborIndex) return;
        const anchor = worldToScreen(path.points[index]);
        const neighbor = worldToScreen(path.points[neighborIndex]);
        const dirX =
          capPosition === 'start' ? neighbor.x - anchor.x : anchor.x - neighbor.x;
        const dirY =
          capPosition === 'start' ? neighbor.y - anchor.y : anchor.y - neighbor.y;
        const dirLength = Math.hypot(dirX, dirY);
        if (dirLength === 0) return;
        const unitX = dirX / dirLength;
        const unitY = dirY / dirLength;
        const extension = Math.min(lineWidth, 12);
        context.strokeStyle = strokeColor;
        context.globalAlpha = strokeAlpha;
        context.globalCompositeOperation = 'source-over';
        context.lineWidth = lineWidth;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(anchor.x + unitX * extension, anchor.y + unitY * extension);
        context.lineTo(anchor.x, anchor.y);
        context.stroke();
      };

      context.beginPath();
      const shouldSmooth = shouldSmoothPath(path);
      if (shouldSmooth) {
        drawSmoothPath(path.points);
      } else {
        drawLinearPath(path.points, Boolean(path.isClosed));
      }
      context.strokeStyle = strokeColor;
      context.globalAlpha = strokeAlpha;
      context.globalCompositeOperation = 'source-over';
      context.lineWidth = lineWidth;
      context.lineCap = shouldSmooth ? 'round' : 'butt';
      context.stroke();
      if (!shouldSmooth) {
        drawCap('start');
        drawCap('end');
      }
      const masks = path.eraserMasks ?? [];
      masks.forEach(mask => {
        if (mask.points.length === 0) return;
        context.beginPath();
        const maskFirst = worldToScreen(mask.points[0]);
        context.moveTo(maskFirst.x, maskFirst.y);
        for (let i = 1; i < mask.points.length; i += 1) {
          const screenPoint = worldToScreen(mask.points[i]);
          context.lineTo(screenPoint.x, screenPoint.y);
        }
        context.strokeStyle = path.color;
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'destination-out';
        context.lineWidth = mask.width * camera.scale;
        context.lineCap = 'round';
        context.stroke();
        context.globalCompositeOperation = 'source-over';
      });
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    });
    context.restore();
  }, [camera.scale, paths, viewportSize.height, viewportSize.width, worldToScreen]);

  useEffect(() => {
    drawPaths();
  }, [drawPaths]);

  const instructions = useMemo(() => {
    const panHint = 'Pan: drag with three fingers or hold Space and drag with the mouse.';
    const zoomHint = 'Zoom: pinch with two fingers or hold Cmd/Ctrl while scrolling.';
    const editHint = 'Undo/Redo: Cmd/Ctrl+Z or Shift+Cmd/Ctrl+Z.';
    switch (mode) {
      case 'pan':
        return `${panHint} ${zoomHint} ${editHint}`;
      case 'draw':
        if (drawTool === 'text') {
          return `Sticky note tool: Click to place a block, then type. ${panHint} ${zoomHint} ${editHint}`;
        }
        if (drawTool === 'textbox') {
          return `Text box tool: Click to drop a simple text box. ${panHint} ${zoomHint} ${editHint}`;
        }
        if (imageToolActive) {
          return `Image tool: Click or drag to define the frame, then choose a file. ${panHint} ${zoomHint} ${editHint}`;
        }
        if (isCursorToolActive) {
          return `Cursor: Select a stroke to move it, drag handles to resize, or rotate via the top handle. Hold Shift to drag a selection box or click multiple strokes. ${panHint} ${zoomHint} ${editHint}`;
        }
        if (isCurveLiveEditing) {
          return `Curve edit: Drag anywhere on the new curve to bend it. Click away to lock it in place. ${panHint} ${zoomHint} ${editHint}`;
        }
        if (shapeTool !== 'freeform') {
          const shapeLabel = SHAPE_LABELS[shapeTool] ?? 'shape';
          return `Shapes: Drag to size your ${shapeLabel.toLowerCase()}. ${panHint} ${zoomHint} ${editHint}`;
        }
        return `Draw: Click or single-finger drag to sketch. ${panHint} ${zoomHint} ${editHint}`;
      default:
        return `${panHint} ${zoomHint} ${editHint}`;
    }
  }, [drawTool, isCursorToolActive, isCurveLiveEditing, mode, shapeTool]);

  const surfaceClassName = useMemo(() => {
    const classes = ['canvas-surface'];
    if (effectiveMode === 'pan' || isPanning) {
      classes.push('canvas-surface--panning');
    } else if (mode === 'draw') {
      if (drawTool === 'text' || drawTool === 'textbox') {
        classes.push('canvas-surface--text');
      } else if (isCursorToolActive) {
        classes.push('canvas-surface--cursor');
      } else {
        classes.push('canvas-surface--draw');
      }
    }
    return classes.join(' ');
  }, [drawTool, effectiveMode, isCursorToolActive, isPanning, mode]);

  const shareStatusLabel = useMemo(() => {
    switch (shareStatus) {
      case 'ready':
        return 'Live';
      case 'syncing':
        return 'Syncing';
      case 'error':
        return 'Offline';
      default:
        return 'Disabled';
    }
  }, [shareStatus]);

  const shareStatusDescription = useMemo(() => {
    switch (shareStatus) {
      case 'ready':
        return 'Changes sync instantly across collaborators.';
      case 'syncing':
        return 'Syncing the latest version...';
      case 'error':
        return 'Connection lost. We will retry automatically.';
      default:
        return 'This note is private to your device.';
    }
  }, [shareStatus]);

  const sharePresenceMessage = useMemo(() => {
    if (!shareId) {
      return 'Enable sharing to invite someone else.';
    }
    if (sharePresenceCount <= 1) {
      return 'Only you are connected right now.';
    }
    return `${sharePresenceCount} people are viewing this note.`;
  }, [shareId, sharePresenceCount]);

  const handleInviteSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSendShareInvite();
  }, [onSendShareInvite]);

  const isSendingInvite = shareInviteStatus === 'sending';
  const disableInviteButton = isSendingInvite || !shareInviteValue.trim() || !canUseShare;

  return (
    <div className="canvas-wrapper">
      {onOpenAccountPanel && (
        <button
          type="button"
          className="account-button"
          aria-label={
            username
              ? `Signed in as ${username}`
              : accountEmail
                ? `Signed in as ${accountEmail}`
                : 'Sign in'
          }
          title={
            username
              ? `Signed in as ${username}`
              : accountEmail
                ? `Signed in as ${accountEmail}`
                : 'Sign in or create an account'
          }
          onClick={onOpenAccountPanel}
        >
          {username ?? accountEmail ?? 'Sign in'}
        </button>
      )}
      <button
        type="button"
        className={`collaboration-button${!canUseShare ? ' collaboration-button--disabled' : ''}`}
        aria-label="Open collaboration tools"
        aria-disabled={!canUseShare}
        title={canUseShare ? 'Collaboration' : shareRestrictionMessage ?? 'Sharing unavailable'}
        onClick={handleCollaborationButtonClick}
      >
        <img src={peopleIcon} alt="" aria-hidden="true" />
      </button>
      <div
        className={surfaceClassName}
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onContextMenu={handleContextMenu}
        style={gridStyle}
      >
        <canvas ref={canvasRef} className="drawing-layer" />
        <div
          className="world-layer"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
          }}
        >
          {imageToolEnabled && imageDraftRect && (
            <div
              className="image-node image-node--draft"
              style={{
                left: imageDraftRect.x,
                top: imageDraftRect.y,
                width: imageDraftRect.width || 1,
                height: imageDraftRect.height || 1
              }}
            >
              <div className="image-node__placeholder">Release to place image</div>
            </div>
          )}
          {imageNodes.map(node => (
            <ImageNodeView
              key={node.id}
              node={node}
              onDelete={onDeleteImageNode}
              onMove={onMoveImageNode}
              onResize={onResizeImageNode}
              cameraScale={camera.scale}
              drawTool={drawTool}
            />
          ))}
          {textNodes.map(node => (

            <TextNodeView
              key={node.id}
              node={node}
              onChange={onUpdateTextNode}
              onDelete={onDeleteTextNode}
              onMove={onMoveTextNode}
              onResize={onResizeTextNode}
              onUpdateStyle={onUpdateTextNodeStyle}
              cameraScale={camera.scale}
              shouldFocus={pendingFocusId === node.id}
              onFocused={clearPendingFocus}
              onContextMenu={handleTextNodeContextMenu}
              isSelected={selectedTextNodeIds.includes(node.id)}
              onSelect={handleSelectTextNode}
              drawTool={drawTool}
            />
          ))}
        </div>
        {showSelectionBox && selectionBox && (
          <>
            {showCurveHandles && selectedPath?.curve &&
              selectedPath.curve.nodes.map((node, index) => {
                const screenPoint = worldToScreen(node.anchor);
                const descriptor: CurveHandleDescriptor = { kind: 'anchor', nodeIndex: index };
                return (
                  <div
                    key={`curve-anchor-${index}`}
                    className="curve-handle curve-handle--anchor"
                    style={{
                      left: screenPoint.x,
                      top: screenPoint.y
                    }}
                    onPointerDown={handleCurveHandlePointerDown(descriptor)}
                  />
                );
              })}
            {isCursorToolActive && hasSelection && (
              <>
                <div
                  className="selection-rotation-line"
                  style={{
                    left: selectionBox.left + selectionBox.width / 2,
                    top: selectionBox.top - 24,
                    height: 24
                  }}
                />
                <div
                  className="selection-rotation-handle"
                  style={{
                    left: selectionBox.left + selectionBox.width / 2,
                    top: selectionBox.top - 36
                  }}
                  onPointerDown={handleRotationHandlePointerDown}
                />
              </>
            )}
            <div
              className="selection-box"
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height
              }}
            />
            {isCursorToolActive &&
              hasSelection &&
              HANDLE_CONFIG.map(handle => {
                const handleLeft = selectionBox.left + handle.x * selectionBox.width;
                const handleTop = selectionBox.top + handle.y * selectionBox.height;
                return (
                  <div
                    key={handle.id}
                    className="selection-handle"
                    style={{
                      left: handleLeft,
                      top: handleTop,
                      cursor: handle.cursor
                    }}
                    onPointerDown={handleSelectionHandlePointerDown(handle.id)}
                  />
                );
              })}
          </>
        )}
        {marqueeRect && (
          <div
            className="marquee-selection"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height
            }}
          />
        )}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="canvas-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={event => event.stopPropagation()}
            onContextMenu={event => event.preventDefault()}
          >
            {contextMenuItems.map(item =>
              item.separator ? (
                <div key={item.key} className="canvas-context-menu__separator" />
              ) : (
                <button
                  type="button"
                  key={item.key}
                  onClick={handleMenuAction(item.action)}
                  disabled={item.disabled}
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        )}
        {textContextMenu && textContextTarget && (
          <div
            ref={textContextMenuRef}
            className="text-context-menu"
            style={{ left: textContextMenu.x, top: textContextMenu.y }}
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="text-context-menu__group">
              <span className="text-context-menu__title">Actions</span>
              <div className="text-context-menu__grid">
                <button type="button" onClick={() => handleTextContextAction('copy')}>
                  Copy
                </button>
                <button type="button" onClick={() => handleTextContextAction('duplicate')}>
                  Duplicate
                </button>
                <button type="button" onClick={() => handleTextContextAction('cut')}>
                  Cut
                </button>
                <button type="button" onClick={() => handleTextContextAction('delete')}>
                  Delete
                </button>
                <button type="button" onClick={() => handleTextContextAction('forward')}>
                  Bring Fwd
                </button>
                <button type="button" onClick={() => handleTextContextAction('backward')}>
                  Send Back
                </button>
                <button type="button" onClick={() => handleTextContextAction('front')}>
                  Front
                </button>
                <button type="button" onClick={() => handleTextContextAction('back')}>
                  Back
                </button>
              </div>
            </div>
            <div className="text-context-menu__row">
              <label htmlFor="text-menu-size">Text Size</label>
              <select
                id="text-menu-size"
                value={textContextScaleValue}
                onChange={event => handleTextContextSizeSelect(event.target.value)}
              >
                {!TEXT_SIZE_PRESETS.includes(textContextTarget.fontScale ?? 1) && (
                  <option value={textContextScaleValue}>{textContextScaleValue}</option>
                )}
                {TEXT_SIZE_PRESETS.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-context-menu__row">
              <label htmlFor="text-menu-font">Font</label>
              <select
                id="text-menu-font"
                value={textContextFontValue}
                onChange={event => handleTextContextFontSelect(event.target.value)}
              >
                {!FONT_PRESETS.includes(textContextFontValue) && (
                  <option value={textContextFontValue}>{textContextFontValue}</option>
                )}
                {FONT_PRESETS.map(font => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-context-menu__row">
              <label htmlFor="text-menu-color">Color</label>
              <input
                id="text-menu-color"
                type="color"
                value={textContextTarget.color ?? '#111827'}
                onChange={event => handleTextContextColorSelect(event.target.value)}
              />
            </div>
            <div className="text-context-menu__actions">
              <button type="button" onClick={handleTextContextLockToggle}>
                {textContextTarget.locked ? 'Unlock Position' : 'Lock Position'}
              </button>
              <button type="button" onClick={closeTextContextMenu}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      {isCollaborationOpen && (
        <div
          className="collaboration-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Invite collaborators"
          onClick={handleCloseCollaborationOverlay}
        >
          <div
            ref={collaborationOverlayRef}
            className="collaboration-overlay__content"
            tabIndex={-1}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                handleCloseCollaborationOverlay();
              }
            }}
          >
            <button
              type="button"
              className="collaboration-overlay__close"
              onClick={handleCloseCollaborationOverlay}
            >
              Close
            </button>
            <div className="share-pane">
              <h2>Invite collaborators</h2>
              <form className="share-pane__form" onSubmit={handleInviteSubmit}>
                <label htmlFor="share-invite-input">Username or email</label>
                <input
                  id="share-invite-input"
                  type="text"
                  value={shareInviteValue}
                  onChange={event => onShareInviteChange(event.target.value)}
                  placeholder="e.g. ShankDank"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isSendingInvite || !canUseShare}
                />
                <button type="submit" disabled={disableInviteButton}>
                  {isSendingInvite ? 'Sending invite…' : 'Send invite'}
                </button>
              </form>
              {shareInviteMessage && (
                <p
                  className={`share-pane__message share-pane__message--${shareInviteStatus}`}
                  aria-live="polite"
                >
                  {shareInviteMessage}
                </p>
              )}
              {!canUseShare && shareRestrictionMessage && (
                <p className="share-pane__hint share-pane__hint--warning">
                  {shareRestrictionMessage}
                </p>
              )}
              {canUseShare && !shareId && (
                <p className="share-pane__hint">
                  Sharing turns on automatically when you send your first invite.
                </p>
              )}
              {onOpenAccountPanel && (
                <p className="share-pane__hint">
                  Need to update your account?{' '}
                  <button type="button" onClick={onOpenAccountPanel}>
                    Open profile
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


interface TextNodeProps {
  node: CanvasTextNode;
  onChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number, fontScale?: number, fontScaleLocked?: boolean) => void;
  onUpdateStyle: (id: string, updates: Partial<Pick<CanvasTextNode, 'fontScale' | 'fontFamily' | 'fontScaleLocked' | 'locked' | 'width' | 'height' | 'color'>>) => void;
  cameraScale: number;
  shouldFocus: boolean;
  onFocused: () => void;
  onContextMenu: (id: string, clientX: number, clientY: number) => void;
  isSelected: boolean;
  onSelect: (id: string, additive: boolean) => void;
  drawTool: DrawTool;
}


interface ImageNodeProps {
  node: CanvasImageNode;
  onDelete: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  cameraScale: number;
  drawTool: DrawTool;
}

const IMAGE_MIN_WIDTH = 120;
const IMAGE_MIN_HEIGHT = 90;
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_HEIGHT = 1200;


const ImageNodeView = ({
  node,
  onDelete,
  onMove,
  onResize,
  cameraScale,
  drawTool
}: ImageNodeProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const resizeState = useRef<{
    pointerId: number;
    originWidth: number;
    originHeight: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    currentWidth: number;
    currentHeight: number;
    currentX: number;
    currentY: number;
    handle: ResizeHandleConfig;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const canInteract = drawTool === 'cursor';
  const className = [
    'image-node',
    (isDragging || isResizing) ? 'image-node--active' : ''
  ].filter(Boolean).join(' ');

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    dragState.current = {
      pointerId: event.pointerId,
      originX: node.x,
      originY: node.y,
      startX: event.clientX,
      startY: event.clientY
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - state.startX) / cameraScale;
    const deltaY = (event.clientY - state.startY) / cameraScale;
    onMove(node.id, state.originX + deltaX, state.originY + deltaY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragState.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginResize = (handle: ResizeHandleConfig, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    resizeState.current = {
      pointerId: event.pointerId,
      originWidth: node.width,
      originHeight: node.height,
      originX: node.x,
      originY: node.y,
      startX: event.clientX,
      startY: event.clientY,
      currentWidth: node.width,
      currentHeight: node.height,
      currentX: node.x,
      currentY: node.y,
      handle
    };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const clampWidth = (value: number) => Math.min(Math.max(value, IMAGE_MIN_WIDTH), IMAGE_MAX_WIDTH);
  const clampHeight = (value: number) => Math.min(Math.max(value, IMAGE_MIN_HEIGHT), IMAGE_MAX_HEIGHT);

  const updateResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - state.startX) / cameraScale;
    const deltaY = (event.clientY - state.startY) / cameraScale;
    let nextWidth = state.originWidth;
    let nextHeight = state.originHeight;
    let nextX = state.originX;
    let nextY = state.originY;
    const handle = state.handle;
    if (handle.xDir === 1) {
      nextWidth = clampWidth(state.originWidth + deltaX);
    } else if (handle.xDir === -1) {
      nextWidth = clampWidth(state.originWidth - deltaX);
      const appliedDelta = state.originWidth - nextWidth;
      nextX = state.originX + appliedDelta;
    }
    if (handle.yDir === 1) {
      nextHeight = clampHeight(state.originHeight + deltaY);
    } else if (handle.yDir === -1) {
      nextHeight = clampHeight(state.originHeight - deltaY);
      const appliedDelta = state.originHeight - nextHeight;
      nextY = state.originY + appliedDelta;
    }
    state.currentWidth = nextWidth;
    state.currentHeight = nextHeight;
    state.currentX = nextX;
    state.currentY = nextY;
    onMove(node.id, nextX, nextY);
    onResize(node.id, nextWidth, nextHeight);
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeState.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onMove(node.id, state.currentX, state.currentY);
    onResize(node.id, state.currentWidth, state.currentHeight);
  };

  const handleContainerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.image-node__button')) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    beginDrag(event);
  };

  const handleContainerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (dragState.current) {
      updateDrag(event);
    }
  };

  const handleContainerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (dragState.current) {
      endDrag(event);
    }
  };

  const handleContainerPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (dragState.current) {
      endDrag(event);
    }
  };

  const handleResizePointerDown = (handle: ResizeHandleConfig) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    event.preventDefault();
    beginResize(handle, event);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (resizeState.current) {
      updateResize(event);
    }
  };

  const handleResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (resizeState.current) {
      endResize(event);
    }
  };

  const handleResizePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    event.stopPropagation();
    if (resizeState.current) {
      endResize(event);
    }
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerCancel}
    >
      <img src={node.src} alt="Inserted canvas element" draggable={false} />
      <div className="image-node__actions">
        <button
          type="button"
          className="image-node__button"
          onClick={event => {
            event.stopPropagation();
            onDelete(node.id);
          }}
          title="Delete image"
        >
          ×
        </button>
      </div>
      {canInteract &&
        TEXTBOX_RESIZE_HANDLES.map(handle => (
          <div
            key={handle.id}
            className="image-node__resize-handle"
            style={{ cursor: handle.cursor, ...handle.style }}
            onPointerDown={handleResizePointerDown(handle)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerCancel}
          />
        ))}
    </div>
  );
};

const TextNodeView = ({
  node,
  onChange,
  onDelete,
  onMove,
  onResize,
  onUpdateStyle,
  cameraScale,
  shouldFocus,
  onFocused,
  onContextMenu: onTextContextMenu,
  isSelected,
  onSelect,
  drawTool
}: TextNodeProps) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const variant = node.kind ?? 'sticky';
  const isLabel = variant === 'label';
  const isTextBox = variant === 'textbox' || isLabel;
  const isLocked = isLabel ? true : !!node.locked;
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const resizeState = useRef<{
    pointerId: number;
    originWidth: number;
    originHeight: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    currentWidth: number;
    currentHeight: number;
    currentX: number;
    currentY: number;
    handle: ResizeHandleConfig;
    shiftKey: boolean;
  } | null>(null);
  const className = [
    'text-node',
    isLabel ? 'text-node--label' : isTextBox ? 'text-node--textbox' : 'text-node--sticky',
    isTextBox && (isFocused || isDragging || isResizing) ? 'text-node--textbox-active' : '',
    isLocked ? 'text-node--locked' : '',
    isSelected ? 'text-node--selected' : ''
  ].filter(Boolean).join(' ');
  const placeholder = isLabel ? '' : isTextBox ? 'Start typing...' : 'Jot something down...';
  const fontFamily = node.fontFamily ?? 'Inter';
  const textColor = node.color ?? '#111827';
  const isTextBoxToolActive = isTextBox && drawTool === 'textbox';
  const canInteractWithTextBox = !isTextBox || drawTool === 'cursor' || drawTool === 'textbox';
  const minWidth = isLabel ? LABEL_BASE_WIDTH : TEXTBOX_BASE_WIDTH;
  const maxWidth = isLabel ? LABEL_MAX_WIDTH : TEXTBOX_MAX_WIDTH;
  const minHeight = isLabel ? LABEL_MIN_HEIGHT : TEXTBOX_MIN_HEIGHT;

  const isPointInsideTextContent = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTextBoxToolActive) return true;
    const textarea = ref.current;
    if (!textarea) return true;
    if (!textarea.value.trim()) return false;
    const rect = textarea.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    if (offsetX < 0 || offsetY < 0 || offsetX > rect.width || offsetY > rect.height) {
      return false;
    }
    const textWidth = Math.min(textarea.scrollWidth, rect.width);
    const textHeight = Math.min(textarea.scrollHeight, rect.height);
    const tolerance = 6;
    return offsetX <= textWidth + tolerance && offsetY <= textHeight + tolerance;
  };

  useEffect(() => {
    if (shouldFocus && ref.current) {
      ref.current.focus();
      onFocused();
    }
  }, [shouldFocus, onFocused]);

  useEffect(() => {
    if (canInteractWithTextBox) return;
    if (isFocused) {
      setIsFocused(false);
    }
    if (ref.current && document.activeElement === ref.current) {
      ref.current.blur();
    }
  }, [canInteractWithTextBox, isFocused]);

  const setTextBoxDimensions = useCallback((width: number, height: number) => {
    const textarea = ref.current;
    const container = containerRef.current;
    if (container) {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
    }
    if (textarea) {
      textarea.style.width = `${width}px`;
      textarea.style.height = `${height}px`;
    }
  }, []);

  const resizeTextBox = useCallback(() => {
    const textarea = ref.current;
    const container = containerRef.current;
    if (!container) return;
    if (!isTextBox || !textarea) {
      container.style.width = '';
      container.style.height = '';
      if (textarea) {
        textarea.style.width = '';
        textarea.style.height = '';
      }
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.width = 'auto';
    const baseWidth = node.width ?? minWidth;
    const baseHeight = node.height ?? minHeight;
    let measuredWidth = Math.ceil(textarea.scrollWidth + 2);
    let measuredHeight = Math.ceil(textarea.scrollHeight + 2);
    const storedScale = node.fontScale ?? 1;

    const handleScale = storedScale;
    if (Math.abs(handleScale - 1) > 0.001) {
      textarea.style.fontSize = `${0.95 * handleScale}rem`;
      textarea.style.lineHeight = `${1.4 * (1 + (handleScale - 1) * 0.4)}rem`;
      textarea.style.height = 'auto';
      textarea.style.width = 'auto';
      measuredWidth = Math.ceil(textarea.scrollWidth + 2);
      measuredHeight = Math.ceil(textarea.scrollHeight + 2);
    } else {
      textarea.style.fontSize = '';
      textarea.style.lineHeight = '';
    }
    const nextWidth = Math.min(Math.max(measuredWidth, baseWidth, minWidth), maxWidth);
    const nextHeight = Math.max(measuredHeight, baseHeight, minHeight);
    setTextBoxDimensions(nextWidth, nextHeight);
    const widthChanged = Math.abs((node.width ?? minWidth) - nextWidth) > 0.5;
    const heightChanged = Math.abs((node.height ?? minHeight) - nextHeight) > 0.5;
    if ((widthChanged || heightChanged) && !isResizing) {
      onResize(node.id, nextWidth, nextHeight);
    }
  }, [isResizing, isTextBox, maxWidth, minHeight, minWidth, node.fontScale, node.height, node.id, node.width, onResize, setTextBoxDimensions]);

  useLayoutEffect(() => {
    resizeTextBox();
  }, [node.fontScale, node.text, node.width, node.height, resizeTextBox]);

  const handleTextareaFocus = () => {
    setIsFocused(true);
    resizeTextBox();
  };

  const handleTextareaBlur = (event: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false);
    if (isTextBox) {
      const value = event.currentTarget.value.trim();
      if (!value) {
        onDelete(node.id);
      }
    }
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTextBox || isLocked || !canInteractWithTextBox) return;
    dragState.current = {
      pointerId: event.pointerId,
      originX: node.x,
      originY: node.y,
      startX: event.clientX,
      startY: event.clientY
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    ref.current?.focus();
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteractWithTextBox) return;
    if (!canInteractWithTextBox) return;
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - state.startX) / cameraScale;
    const deltaY = (event.clientY - state.startY) / cameraScale;
    onMove(node.id, state.originX + deltaX, state.originY + deltaY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragState.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginResize = (handle: ResizeHandleConfig, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTextBox || isLocked || !canInteractWithTextBox) return;
    const originWidth = node.width ?? minWidth;
    const originHeight = node.height ?? minHeight;
    const originX = node.x;
    const originY = node.y;
    resizeState.current = {
      pointerId: event.pointerId,
      originWidth,
      originHeight,
      originX,
      originY,
      startX: event.clientX,
      startY: event.clientY,
      currentWidth: originWidth,
      currentHeight: originHeight,
      currentX: originX,
      currentY: originY,
      handle,
      shiftKey: event.shiftKey
    };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    ref.current?.focus();
  };

  const updateResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canInteractWithTextBox) return;
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const handle = state.handle;
    event.preventDefault();
    const deltaX = (event.clientX - state.startX) / cameraScale;
    const deltaY = (event.clientY - state.startY) / cameraScale;
    const clampWidthValue = (value: number) => Math.min(Math.max(value, minWidth), maxWidth);
    const clampHeightValue = (value: number) => Math.max(value, minHeight);
    let nextWidth = state.originWidth;
    let nextHeight = state.originHeight;
    let nextX = state.originX;
    let nextY = state.originY;

    if (handle.xDir === 1) {
      nextWidth = clampWidthValue(state.originWidth + deltaX);
    } else if (handle.xDir === -1) {
      nextWidth = clampWidthValue(state.originWidth - deltaX);
      const appliedDelta = state.originWidth - nextWidth;
      nextX = state.originX + appliedDelta;
    }

    if (handle.yDir === 1) {
      nextHeight = clampHeightValue(state.originHeight + deltaY);
    } else if (handle.yDir === -1) {
      nextHeight = clampHeightValue(state.originHeight - deltaY);
      const appliedDelta = state.originHeight - nextHeight;
      nextY = state.originY + appliedDelta;
    }

    const positionChanged =
      Math.abs(nextX - state.currentX) > 0.001 || Math.abs(nextY - state.currentY) > 0.001;

    state.currentWidth = nextWidth;
    state.currentHeight = nextHeight;
    state.currentX = nextX;
    state.currentY = nextY;
    setTextBoxDimensions(nextWidth, nextHeight);
    if (ref.current) {
      ref.current.style.fontSize = '';
      ref.current.style.lineHeight = '';
    }
    if (positionChanged) {
      onMove(node.id, nextX, nextY);
    }
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeState.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (Math.abs(state.currentX - node.x) > 0.001 || Math.abs(state.currentY - node.y) > 0.001) {
      onMove(node.id, state.currentX, state.currentY);
    }
    const fontScale = undefined;
    onResize(
      node.id,
      state.currentWidth,
      state.currentHeight,
      fontScale,
      fontScale !== undefined ? true : undefined
    );
  };

  const handleContainerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isTextBoxToolActive && event.shiftKey) {
      return;
    }
    if (!canInteractWithTextBox) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') {
      onSelect(node.id, event.shiftKey);
      return;
    }
    const isInsideText = isPointInsideTextContent(event);
    if (!isInsideText && !isTextBoxToolActive) {
      return;
    }
    event.stopPropagation();
    onSelect(node.id, event.shiftKey);
    if (!isTextBox || isLocked) return;
    event.preventDefault();
    beginDrag(event);
  };

  const handleContainerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isTextBox || isLocked || !canInteractWithTextBox) return;
    updateDrag(event);
  };

  const handleContainerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isTextBox || isLocked || !canInteractWithTextBox) return;
    endDrag(event);
  };

  const handleContainerPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isTextBox || isLocked || !canInteractWithTextBox) return;
    endDrag(event);
  };

  const handleContainerContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    onTextContextMenu(node.id, event.clientX, event.clientY);
  };

  const handleResizePointerDown = (handle: ResizeHandleConfig) => (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (!canInteractWithTextBox) return;
    onSelect(node.id, event.shiftKey);
    beginResize(handle, event);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!canInteractWithTextBox) return;
    if (resizeState.current) {
      resizeState.current.shiftKey = event.shiftKey;
    }
    updateResize(event);
  };

  const handleResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!canInteractWithTextBox) return;
    endResize(event);
  };

  const handleResizePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!canInteractWithTextBox) return;
    endResize(event);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ left: node.x, top: node.y, fontFamily, color: textColor }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerCancel}
      onContextMenu={handleContainerContextMenu}
    >
      <textarea
        ref={ref}
        value={node.text}
        placeholder={placeholder}
        onChange={event => onChange(node.id, event.target.value)}
        onFocus={handleTextareaFocus}
        onBlur={handleTextareaBlur}
        readOnly={isLabel}
        onPointerDown={event => {
          if (isTextBoxToolActive && event.shiftKey) {
            event.preventDefault();
            return;
          }
          if (!canInteractWithTextBox) {
            event.preventDefault();
            return;
          }
          onSelect(node.id, event.shiftKey);
          event.stopPropagation();
        }}
        style={{ fontFamily, color: textColor }}
      />
      {isTextBox && (isFocused || isDragging || isResizing) &&
        TEXTBOX_RESIZE_HANDLES.map(handle => (
          <div
            key={handle.id}
            className="text-node__resize-handle"
            style={{ cursor: handle.cursor, ...handle.style }}
            onPointerDown={handleResizePointerDown(handle)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerCancel}
          />
        ))}
      {!isTextBox && (
        <button
          className="text-node__delete"
          onClick={() => onDelete(node.id)}
          title="Delete text block"
        >
          ×
        </button>
      )}
    </div>
  );
};

export default CanvasViewport;
