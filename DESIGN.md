# NotesTaker Plus – Product & Technical Design

## 1. Product Vision
NotesTaker Plus is a native macOS canvas for teams who need to ideate, sketch, and outline ideas together in real time. Each page is a shared infinite workspace with fluid transitions between typed content, hand-drawn sketches, pasted media, and embedded files. The app balances the feel of a tactile whiteboard with the structure of a text editor.

### Goals
- **Seamless collaboration:** multiple users edit the same page simultaneously with low latency and visible presence indicators.
- **Infinite expressiveness:** canvas can pan/zoom without bounds, supporting both handwriting and precision typing/interactions.
- **Mac-first experience:** leverage macOS design language, keyboard shortcuts, and trackpad/Apple Pencil via Sidecar/Continuity for drawing.
- **Reliable sync:** pages remain available offline and merge changes automatically once connectivity returns.

## 2. Target Personas & Jobs
- **Product teams:** capture brainstorming sessions, flowcharts, and action items concurrently.
- **Students/study groups:** share lecture notes, annotate diagrams, and plan projects in one space.
- **Designers:** mix mood boards, sketches, sticky notes, and typed annotations.

## 3. Core Requirements
| Area | Requirements |
| --- | --- |
| Multi-user | Real-time editing with conflict-free replication, live cursors, contributor list, presence/typing indicators, version history & restore points. |
| Infinite canvas | Pan/zoom with trackpad gestures, inertia scrolling, minimap/overview, snap-to-grid option, auto-recenter button. |
| Typing | Rich text, headings, bullet/number lists, checklists, inline code, quick styles via Markdown-like shortcuts, drag-to-reorder blocks. |
| Drawing | Vector-based brush engine, pressure/tilt support (Sidecar & graphics tablets), shape recognition, highlighter, eraser, lasso select, layering. |
| Media | Paste images/files, capture screenshots, audio snippets, sticky notes. |
| Organization | Workspace → Notebooks → Pages. Tags, search, filters, favorites, templates. |
| Offline | Local cache, optimistic updates, queued operations; clear status for sync conflicts. |
| Security | Account auth (Sign in with Apple), per-workspace access control, E2E encryption for notes/drawings at rest, TLS in transit. |

## 4. High-Level Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                           macOS Client                          │
│ SwiftUI UI layer ──> Canvas Engine ──> CRDT State ──> Sync Core │
└─────────────────────────────────────────────────────────────────┘
            ▲                         │                          ▼
            │                         │                WebSocket / gRPC
            │                         │
┌───────────────────────────┐   ┌───────────────────────────────────┐
│ CloudKit (default)        │   │ Optional custom collaboration API │
│ - Auth                    │   │ - Real-time fan-out               │
│ - Private/public DBs      │   │ - Presence service (Redis)        │
│ - Asset storage           │   │ - History snapshots               │
└───────────────────────────┘   └───────────────────────────────────┘
```

- **Client:** SwiftUI + Combine handles UI; Metal-backed canvas handles rendering; background tasks keep local Core Data/SQLite cache in sync.
- **Collaboration core:** CRDT (Conflict-free Replicated Data Type) state machine (e.g., Yjs or custom JSON CRDT) ensures deterministic merges for both text blocks and vector strokes.
- **Transport:** Persistent WebSocket for live collaboration; fallback to CloudKit subscriptions for push notifications; HTTP/GraphQL for initial page loads and history.
- **Storage:** Hybrid approach—local store for offline edits + CloudKit record zones per workspace/page. Attachments stored as CKAssets (or S3-equivalent if custom backend).

## 5. Data Model (simplified)

- `Workspace`: id, name, owners, members, permissions.
- `Notebook`: id, workspaceId, title, ordering, tags.
- `Page`: id, notebookId, title, thumbnail, canvasState (CRDT snapshot), createdAt, updatedAt.
- `Block`: embedded data inside canvas (text, drawing group, image). Represented by nodes in CRDT.
- `Presence`: ephemeral state (userId, cursor position, selection, color).

## 6. Collaboration Flow
1. User opens a page → client fetches latest snapshot + deltas since last sync.
2. Client joins WebSocket room `workspaceId:pageId` and advertises presence color/name/status.
3. User edits content (text or drawing). Operation is converted into CRDT update and applied locally instantly.
4. Update is broadcast to peers via WebSocket and written to local queue.
5. Background sync worker batches operations and commits to server/CloudKit.
6. On reconnect, client requests missing operations; CRDT resolves order deterministically.
7. Version history checkpoints stored every N operations or 30s to allow rollbacks.

## 7. Infinite Canvas Implementation
- **Coordinate system:** floating-point world coordinates anchored at (0,0); camera state stores translation + zoom.
- **Rendering:** Metal or Core Animation layers to maintain 120 FPS; quadtree spatial index to cull off-screen elements.
- **Navigation UI:** trackpad pinch-to-zoom, two-finger pan; command palette actions (`Cmd+0` fit to content, `Cmd+2` zoom to selection).
- **Minimap:** overlay showing anchors for collaborators and quick jumping.
- **Smart layout:** optional layout guides and snapping; auto-sizing for text blocks when zoom level changes.

## 8. Typing Experience
- **Block model:** each text element is a block with attributes (style, alignment, block type). Blocks can be nested or grouped.
- **Editing:** Markdown shortcuts (`#`, `-`, `>` etc.), slash command menu for inserting blocks, quick duplication (`Cmd+D`).
- **Styling:** floating formatting toolbar + inspector panel for fonts, colors, spacing. Supports inline links, @mentions, and checklists.
- **Accessibility:** full keyboard navigation, VoiceOver labels, dynamic type scaling, contrast-checked color palette.

## 9. Drawing & Ink System
- **Brush engine:** vector strokes with variable width, color, opacity, blend modes. Catmull-Rom interpolation for smooth curves.
- **Tools:** Pen, pencil, highlighter, marker, shape tool, text callouts, lasso, eraser (stroke-level + pixel nib), ruler/grid overlays.
- **Input:** Continuity for Apple Pencil, trackpad sketch mode, external tablets (Wacom). Pressure mapped to velocity for natural feel.
- **Layering:** strokes grouped into layers; reorder layers to keep annotations behind/above typed content. Hide/lock layers.

## 10. Presence & Collaboration UI
- Avatars of active collaborators displayed in toolbar.
- Live cursors with user color/name label; can be toggled off.
- Follow mode: click collaborator avatar to sync viewport.
- Commenting: anchored comments/resolutions with notifications.
- Activity timeline: highlight recent edits; restore to previous checkpoints.

## 11. Offline & Sync Reliability
- Local cache (Core Data or SQLite) stores full page snapshot + queued operations.
- Background task watchers flush queue when connectivity returns.
- Conflict indicator shows unsynced edits with retry options.
- Snapshot compression + delta packaging keeps storage manageable.

## 12. Security & Permissions
- Sign in with Apple or managed enterprise SSO.
- Workspaces have roles: Owner, Editor, Commenter, Viewer.
- Per-page share links with expiring tokens.
- All data encrypted at rest (FileVault + CloudKit), TLS 1.3 in transit.
- Optional on-device encryption keys derived from user credentials.

## 13. Testing & QA Strategy
- Unit tests for CRDT operations, data model conversions, brush engine math.
- UI tests (XCTest + XCUITest) for typing/drawing flows.
- Snapshot tests for rendering correctness across zoom levels/themes.
- Load tests for collaboration sessions (simulate 20+ concurrent users).
- Chaos testing for offline/online transitions and merge conflicts.

## 14. Roadmap Phases
1. **Foundation (MVP):** Single-user infinite canvas, text blocks, drawing tools, local persistence.
2. **Collaboration Alpha:** Real-time sync, presence, shared workspaces, conflict resolution.
3. **Productization:** Templates, media attachments, commenting, search, history, macOS polish.
4. **Ecosystem:** iPad companion, web spectator mode, plugins/integrations (Jira, Slack, calendar).

## 15. Metrics & Success Criteria
- Weekly active collaborative pages & average collaborators per page.
- Median connection-to-edit latency (<150 ms target).
- Sync reliability (successful operation commit rate >99.9%).
- Retention of new workspaces after 4 weeks.
- NPS for typing & drawing experiences.

This design document provides a blueprint for building NotesTaker Plus as a high-performance, collaborative, and infinitely scalable Mac-native notes canvas.
