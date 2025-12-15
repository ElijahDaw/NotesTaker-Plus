import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, type CanvasMode, type DrawTool, type ShapeTool } from './CanvasViewport';
import { FONT_PRESETS, TEXT_SIZE_PRESETS } from '../constants/textOptions';
import penIcon from '../../icons to use/interface_2891617.png';
import pencilIcon from '../../icons to use/pencil_2043448.png';
import highlighterIcon from '../../icons to use/highlighter_764860.png';
import eraserIcon from '../../icons to use/eraser_15105706.png';
import toolIcon from '../../icons to use/tool_16061640.png';
import hexIcon from '../../icons to use/football_18933871.png';
import stickyNoteIcon from '../../icons to use/notepad_650712.png';
import textIcon from '../../icons to use/text_218734.svg';

interface ToolbarProps {
  currentMode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  drawTool: DrawTool;
  onDrawToolChange: (tool: DrawTool) => void;
  shapeTool: ShapeTool;
  onShapeToolChange: (shape: ShapeTool) => void;
  drawColor: string;
  onDrawColorChange: (color: string) => void;
  zoom: number;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  recentColors: string[];
  textSize: number | null;
  onTextSizeChange: (value: number | null) => void;
  textFont: string;
  onTextFontChange: (value: string) => void;
  onSaveNote: () => void;
  onOpenNote: () => void;
  currentFileLabel?: string | null;
}

const MODE_BUTTONS: Array<{
  label: string;
  value: CanvasMode;
  shortcut: string;
  description: string;
}> = [{ label: 'Draw', value: 'draw', shortcut: 'D', description: 'Freehand pen' }];

const TOOL_BUTTONS: Array<{
  label: string;
  value: DrawTool;
  description: string;
  icon: string;
}> = [
  { label: 'Cursor', value: 'cursor', description: 'Pointer tool', icon: toolIcon },
  { label: 'Pen', value: 'pen', description: 'Balanced sketching', icon: penIcon },
  { label: 'Pencil', value: 'pencil', description: 'Finer strokes', icon: pencilIcon },
  { label: 'Highlighter', value: 'highlighter', description: 'Translucent', icon: highlighterIcon },
  { label: 'Eraser', value: 'eraser', description: 'Remove strokes', icon: eraserIcon }
];

const NOTE_TOOLS: Array<{
  label: string;
  value: DrawTool;
  description: string;
  icon: string;
}> = [
  {
    label: 'Sticky Note',
    value: 'text',
    description: 'Typed sticky',
    icon: stickyNoteIcon
  },
  {
    label: 'Text Box',
    value: 'textbox',
    description: 'Plain text',
    icon: textIcon
  }
];

const COLOR_PRESETS = [
  { label: 'Blue', value: '#2563eb' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Black', value: '#111827' }
];

const SHAPE_OPTIONS: Array<{
  label: string;
  value: ShapeTool;
  description: string;
}> = [
  { label: 'Freeform', value: 'freeform', description: 'Sketch freely' },
  { label: 'Line', value: 'line', description: 'Straight strokes' },
  { label: 'Curve', value: 'curve', description: 'Bendable spline' },
  { label: 'Arrow', value: 'arrow', description: 'Directional pointer' },
  { label: 'Rectangle', value: 'rectangle', description: 'Sharp corners' },
  { label: 'Rounded Rect', value: 'rounded-rectangle', description: 'Smoother boxes' },
  { label: 'Circle', value: 'ellipse', description: 'Perfect loops' },
  { label: 'Triangle', value: 'triangle', description: 'Equilateral' },
  { label: 'Right Triangle', value: 'right-triangle', description: '90° corner' },
  { label: 'Diamond', value: 'diamond', description: 'Rhombus flow' },
  { label: 'Hexagon', value: 'hexagon', description: 'Six-sided badge' },
  { label: 'Star', value: 'star', description: '5-point burst' }
];

const shapeIconProps = {
  width: 36,
  height: 24,
  viewBox: '0 0 36 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const;


const TEXT_SIZE_INPUT_PATTERN = /^(\d+(\.\d*)?)?$/;

const clampTextSize = (value: number) => {
  if (Number.isNaN(value)) return 1;
  return Math.min(Math.max(value, 0.5), 32);
};

const formatTextSizeValue = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '';
  const fixed = Number(value.toFixed(2));
  return Number.isInteger(fixed) ? String(fixed) : fixed.toString();
};

const ShapeChipIcon = ({ shape }: { shape: ShapeTool }) => {
  switch (shape) {
    case 'line':
      return (
        <svg {...shapeIconProps}>
          <line x1="4" y1="20" x2="32" y2="4" />
        </svg>
      );
    case 'curve':
      return (
        <svg {...shapeIconProps}>
          <path d="M4 20 C12 6 18 10 32 4" />
          <circle cx="4" cy="20" r="1.8" fill="currentColor" />
          <circle cx="32" cy="4" r="1.8" fill="currentColor" />
          <circle cx="18" cy="13" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...shapeIconProps}>
          <line x1="4" y1="20" x2="30" y2="8" />
          <polyline points="22 6 30 8 28 16" />
        </svg>
      );
    case 'rectangle':
      return (
        <svg {...shapeIconProps}>
          <rect x="6" y="4" width="24" height="16" rx="2" ry="2" />
        </svg>
      );
    case 'rounded-rectangle':
      return (
        <svg {...shapeIconProps}>
          <rect x="6" y="5" width="24" height="14" rx="6" ry="6" />
        </svg>
      );
    case 'ellipse':
      return (
        <svg {...shapeIconProps}>
          <ellipse cx="18" cy="12" rx="12" ry="8" />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...shapeIconProps}>
          <polygon points="18 4 32 20 4 20" />
        </svg>
      );
    case 'right-triangle':
      return (
        <svg {...shapeIconProps}>
          <polygon points="6 5 30 20 6 20" />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...shapeIconProps}>
          <polygon points="18 3 33 12 18 21 3 12" />
        </svg>
      );
    case 'hexagon':
      return (
        <svg {...shapeIconProps}>
          <polygon points="10 4 26 4 34 12 26 20 10 20 2 12" />
        </svg>
      );
    case 'star':
      return (
        <svg {...shapeIconProps}>
          <polygon points="18 2 21 9 28 9 22 13 24 20 18 16 12 20 14 13 8 9 15 9" />
        </svg>
      );
    case 'freeform':
    default:
      return (
        <svg {...shapeIconProps}>
          <path d="M2 18c4-12 10 12 14 0s10 6 18-6" />
        </svg>
      );
  }
};

const ShapesBadgeIcon = () => (
  <svg
    width="32"
    height="24"
    viewBox="0 0 32 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <rect x="3" y="4" width="14" height="14" rx="3" ry="3" />
    <circle cx="20" cy="12" r="7" />
  </svg>
);

const Toolbar = ({
  currentMode,
  onModeChange,
  drawTool,
  onDrawToolChange,
  shapeTool,
  onShapeToolChange,
  drawColor,
  onDrawColorChange,
  zoom,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onResetView,
  recentColors,
  textSize,
  onTextSizeChange,
  textFont,
  onTextFontChange,
  onSaveNote,
  onOpenNote,
  currentFileLabel
}: ToolbarProps) => {
  const [showHexPicker, setShowHexPicker] = useState(false);
  const [hexValue, setHexValue] = useState(drawColor);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeMenuRef = useRef<HTMLDivElement | null>(null);
  const [textSizeValue, setTextSizeValue] = useState(formatTextSizeValue(textSize));
  const [showTextSizeDropdown, setShowTextSizeDropdown] = useState(false);
  const textSizeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [textFontValue, setTextFontValue] = useState(textFont);

  useEffect(() => {
    setHexValue(drawColor);
  }, [drawColor]);

  useEffect(() => {
    setTextSizeValue(formatTextSizeValue(textSize));
  }, [textSize]);

  useEffect(() => {
    setTextFontValue(textFont);
  }, [textFont]);

  useEffect(() => {
    if (!shapeMenuOpen && !showTextSizeDropdown) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (shapeMenuOpen && shapeMenuRef.current && !shapeMenuRef.current.contains(target)) {
        setShapeMenuOpen(false);
      }
      if (showTextSizeDropdown && textSizeDropdownRef.current && !textSizeDropdownRef.current.contains(target)) {
        setShowTextSizeDropdown(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [shapeMenuOpen, showTextSizeDropdown]);

  const isDrawMode = currentMode === 'draw';
  const fileLabel = currentFileLabel?.trim() || 'Untitled note';
  const { canZoomIn, canZoomOut } = useMemo(() => ({
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM
  }), [zoom]);

  const currentShapeLabel = useMemo(() => {
    const match = SHAPE_OPTIONS.find(option => option.value === shapeTool);
    return match?.label ?? 'Freeform';
  }, [shapeTool]);

  const handleShapeSelection = (value: ShapeTool) => {
    setShapeMenuOpen(false);
    onShapeToolChange(value);
  };

  const handleToolSelect = (value: DrawTool) => {
    onDrawToolChange(value);
  };

  const handleHexInput = (value: string) => {
    setHexValue(value);
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      onDrawColorChange(value);
    }
  };

  const handleTextSizeInput = (value: string) => {
    if (!TEXT_SIZE_INPUT_PATTERN.test(value)) {
      return;
    }
    setTextSizeValue(value);
    if (value.trim() === '') {
      onTextSizeChange(null);
      return;
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return;
    const clamped = clampTextSize(numeric);
    onTextSizeChange(parseFloat(clamped.toFixed(2)));
  };

  const handlePresetSelect = (size: number) => {
    setShowTextSizeDropdown(false);
    setTextSizeValue(size.toString());
    onTextSizeChange(size);
  };

  const handleTextFontInput = (value: string) => {
    setTextFontValue(value);
    onTextFontChange(value);
  };

  return (
    <div className="toolbar-container">
      <header className="toolbar">
        <div className="toolbar__branding">
          <div className="logo-mark">NP</div>
          <div>
            <div className="product-name">NotesTaker Plus</div>
            <div className="product-tagline">Infinite canvas playground</div>
          </div>
        </div>
        <div className="toolbar__file">
          <div className="file-label" title={fileLabel}>
            {fileLabel}
          </div>
          <div className="file-actions">
            <button className="file-button" type="button" onClick={onOpenNote}>
              Open...
            </button>
            <button className="file-button file-button--primary" type="button" onClick={onSaveNote}>
              Save
            </button>
          </div>
        </div>
        {MODE_BUTTONS.length > 1 && (
          <div className="toolbar__modes">
            {MODE_BUTTONS.map(button => (
              <button
                key={button.value}
                className={currentMode === button.value ? 'active' : ''}
                onClick={() => onModeChange(button.value)}
                title={`${button.description} (${button.shortcut})`}
              >
                {button.label}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar__status">
          <div className="zoom-controls">
            <button
              className="history-button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Cmd/Ctrl+Z)"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 14l-5-5 5-5" />
                <path d="M4 9h9a7 7 0 1 1 0 14h-3" />
              </svg>
              <span className="sr-only">Undo</span>
            </button>
            <button
              className="history-button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Shift+Cmd/Ctrl+Z)"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 4l5 5-5 5" />
                <path d="M20 9h-9a7 7 0 1 0 0 14h3" />
              </svg>
              <span className="sr-only">Redo</span>
            </button>
            <button
              className="zoom-button"
              onClick={onZoomOut}
              disabled={!canZoomOut}
              aria-label="Zoom out"
            >
              -
            </button>
            <div className="zoom-indicator">{Math.round(zoom * 100)}%</div>
            <button
              className="zoom-button"
              onClick={onZoomIn}
              disabled={!canZoomIn}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <button className="ghost" onClick={onResetView} title="Recenter canvas">
            Reset View
          </button>
        </div>
      </header>
      {isDrawMode && (
        <div className="draw-panel">
          <div className="draw-panel__section draw-panel__section--shapes">
            <div className="section-label">Shapes</div>
            <div className="shape-dropdown" ref={shapeMenuRef}>
              <button
                className={`shape-dropdown__button${shapeTool !== 'freeform' ? ' active' : ''}`}
                onClick={() => setShapeMenuOpen(prev => !prev)}
                type="button"
              >
                <div className="shape-dropdown__icon">
                  <ShapesBadgeIcon />
                </div>
                <div className="shape-dropdown__labels">
                  <span>Shapes</span>
                  <small>{currentShapeLabel}</small>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 9l6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {shapeMenuOpen && (
                <div className="shape-dropdown__menu">
                  <div className="shape-dropdown__grid">
                    {SHAPE_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        className={`shape-dropdown__option${shapeTool === option.value ? ' active' : ''}`}
                        onClick={() => handleShapeSelection(option.value)}
                        type="button"
                      >
                        <div className="shape-dropdown__optionIcon">
                          <ShapeChipIcon shape={option.value} />
                        </div>
                        <div className="shape-dropdown__optionText">
                          <span>{option.label}</span>
                          <small>{option.description}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="draw-panel__section draw-panel__section--tools">
            <div className="section-label">Tool</div>
            <div className="chip-group">
              {TOOL_BUTTONS.map(tool => (
                <button
                  key={tool.value}
                  className={`chip chip--icon${drawTool === tool.value ? ' active' : ''}`}
                  onClick={() => handleToolSelect(tool.value)}
                  title={tool.description}
                >
                  <img src={tool.icon} alt={`${tool.label} icon`} />
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="draw-panel__section draw-panel__section--text">
            <div className="section-label">Notes</div>
            <div className="text-toolRow">
              <div className="text-tool">
                {NOTE_TOOLS.map(tool => (
                  <button
                    key={tool.value}
                    className={`chip chip--icon${drawTool === tool.value ? ' active' : ''}`}
                    onClick={() => handleToolSelect(tool.value)}
                    title={tool.description}
                  >
                    <img src={tool.icon} alt={`${tool.label} icon`} />
                    <span>{tool.label}</span>
                  </button>
                ))}
                <div className="text-controls">
                  <div className="text-size-inline">
                    <label htmlFor="text-size-input">Text Size</label>
                    <div className="text-size-control__inputs">
                      <input
                        id="text-size-input"
                        type="text"
                        value={textSizeValue}
                        onChange={event => handleTextSizeInput(event.target.value)}
                        placeholder="Size"
                        inputMode="decimal"
                      />
                      <div className="text-size-dropdownWrapper" ref={textSizeDropdownRef}>
                        <button
                          className="text-size-dropdownButton"
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={showTextSizeDropdown}
                          onClick={() => setShowTextSizeDropdown(prev => !prev)}
                        >
                          <span>▼</span>
                        </button>
                        {showTextSizeDropdown && (
                          <ul className="text-size-dropdown" role="listbox">
                            {TEXT_SIZE_PRESETS.map(size => (
                              <li key={size}>
                                <button type="button" onClick={() => handlePresetSelect(size)}>
                                  {size}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-font-inline">
                    <label htmlFor="text-font-select">Font</label>
                    <div className="text-size-control__inputs">
                      <select
                        id="text-font-select"
                        value={textFontValue}
                        onChange={event => handleTextFontInput(event.target.value)}
                      >
                        {FONT_PRESETS.map(font => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="draw-panel__section draw-panel__section--color">
            <div className="section-label">Color</div>
            <div className="color-row">
              <div className="hex-picker">
                <button
                  className={`chip chip--icon${showHexPicker ? ' active' : ''}`}
                  onClick={() => setShowHexPicker(prev => !prev)}
                  title="Custom color"
                >
                  <img src={hexIcon} alt="Hex picker" />
                  <span>HEX</span>
                </button>
                {showHexPicker && (
                  <div className="hex-popover">
                    <div className="hex-popover__inputs">
                      <input
                        type="color"
                        value={hexValue}
                        onChange={event => onDrawColorChange(event.target.value)}
                      />
                      <input
                        type="text"
                        value={hexValue}
                        onChange={event => handleHexInput(event.target.value)}
                        maxLength={7}
                      />
                    </div>
                    <div className="hex-recent">
                      <span className="hex-recent__label">Recent</span>
                      <div className="hex-recent__swatches">
                        {recentColors.map(color => (
                          <button
                            key={color}
                            className={`hex-recent__swatch${color === drawColor ? ' active' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => onDrawColorChange(color)}
                            type="button"
                            aria-label={`Use ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {COLOR_PRESETS.map(color => (
                <button
                  key={color.value}
                  className={`color-swatch${drawColor === color.value ? ' selected' : ''}`}
                  style={{ backgroundColor: color.value }}
                  aria-label={color.label}
                  onClick={() => onDrawColorChange(color.value)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;
