# NotesTaker Plus

An Electron + React desktop playground for the NotesTaker Plus concept. This MVP delivers a real-time infinite canvas that supports panning, zooming, freehand drawing, and typed text blocks so you can explore the interaction model before wiring up collaboration.

## Getting Started

```bash
# install dependencies
npm install

# start Vite dev server + Electron shell
npm run dev
```

The development server opens the renderer at `http://localhost:5173` and launches the Electron shell once it is ready.

### Building

```bash
# produce production assets in dist/
npm run build

# (optional) launch the built renderer inside Electron
npm run preview
```

### Additional scripts

- `npm run typecheck` – run the TypeScript compiler without emitting files.

## Canvas Controls

- **Pan**: choose the Pan mode or hold the space bar while dragging.
- **Zoom**: use the scroll wheel / trackpad pinch to zoom around the cursor location.
- **Draw**: switch to Draw mode and drag to sketch vector strokes.
- **Text**: switch to Text mode, click to place a text block, and start typing. Use the × button to remove the block.
- **Reset view**: click *Reset View* in the toolbar to recenter the canvas (100% zoom).

## Next Steps

- Expand the toolbar to expose brush settings, colors, and block templates.
- Persist canvas state locally, then sync via a CRDT layer for multi-user collaboration.
- Add presence indicators and viewport minimap to align with the product vision in `DESIGN.md`.
