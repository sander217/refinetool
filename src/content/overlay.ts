export type SelectionState = 'locked' | 'editing' | 'edited';

export type OverlayHandles = {
  showHover: (rect: DOMRect) => void;
  hideHover: () => void;
  showSelection: (rect: DOMRect, label: string, state: SelectionState) => void;
  hideSelection: () => void;
  showBanner: (text?: string) => void;
  hideBanner: () => void;
  teardown: () => void;
};

export const OVERLAY_IDS = {
  hover: 'ifl-hover-box',
  selection: 'ifl-selection-box',
  banner: 'ifl-banner',
  styles: 'ifl-overlay-styles',
  inlineEditable: 'ifl-inline-editable',
  inlineEditing: 'ifl-inline-editing',
} as const;

export function createOverlay(): OverlayHandles {
  ensureStyles();

  const hover = spawn('div', OVERLAY_IDS.hover);
  hover.style.display = 'none';

  const selection = spawn('div', OVERLAY_IDS.selection);
  selection.style.display = 'none';
  const selectionLabel = document.createElement('span');
  selectionLabel.className = 'ifl-label';
  selection.appendChild(selectionLabel);

  const banner = spawn('div', OVERLAY_IDS.banner);
  banner.style.display = 'none';
  banner.textContent = 'Refine Mode — click regions to select or retarget · ESC to exit';

  document.documentElement.append(hover, selection, banner);

  return {
    showHover(rect) {
      positionBox(hover, rect);
      hover.style.display = 'block';
    },
    hideHover() {
      hover.style.display = 'none';
    },
    showSelection(rect, label, state) {
      positionBox(selection, rect);
      const prefix =
        state === 'editing' ? '✏️ Editing · ' : state === 'edited' ? '✳︎ Edited · ' : '🔒 Locked · ';
      selectionLabel.textContent = `${prefix}${label}`;
      selection.dataset.state = state;
      selection.style.display = 'block';
    },
    hideSelection() {
      selection.style.display = 'none';
    },
    showBanner(text) {
      if (text) banner.textContent = text;
      banner.style.display = 'block';
    },
    hideBanner() {
      banner.style.display = 'none';
    },
    teardown() {
      hover.remove();
      selection.remove();
      banner.remove();
      const style = document.getElementById(OVERLAY_IDS.styles);
      style?.remove();
    },
  };
}

function spawn(tag: string, id: string): HTMLElement {
  const el = document.createElement(tag);
  el.id = id;
  return el as HTMLElement;
}

function positionBox(el: HTMLElement, rect: DOMRect) {
  el.style.top = `${rect.top}px`;
  el.style.left = `${rect.left}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

function ensureStyles() {
  if (document.getElementById(OVERLAY_IDS.styles)) return;
  const style = document.createElement('style');
  style.id = OVERLAY_IDS.styles;
  style.textContent = `
    #${OVERLAY_IDS.hover}, #${OVERLAY_IDS.selection} {
      position: fixed;
      pointer-events: none;
      z-index: 2147483646;
      box-sizing: border-box;
      border-radius: 6px;
      transition: top 80ms ease-out, left 80ms ease-out, width 80ms ease-out, height 80ms ease-out;
    }
    #${OVERLAY_IDS.hover} {
      border: 2px solid rgba(88, 101, 242, 0.9);
      background: rgba(88, 101, 242, 0.12);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
    }
    #${OVERLAY_IDS.selection} {
      border: 2px solid rgba(34, 197, 94, 0.95);
      background: rgba(34, 197, 94, 0.10);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.5);
    }
    #${OVERLAY_IDS.selection}[data-state="editing"] {
      border-color: rgba(147, 51, 234, 0.95);
      background: rgba(147, 51, 234, 0.10);
    }
    #${OVERLAY_IDS.selection}[data-state="edited"] {
      border-color: rgba(234, 88, 12, 0.95);
      background: rgba(234, 88, 12, 0.10);
    }
    #${OVERLAY_IDS.selection}[data-state="editing"] .ifl-label {
      background: rgba(88, 28, 135, 0.95);
    }
    #${OVERLAY_IDS.selection}[data-state="edited"] .ifl-label {
      background: rgba(124, 45, 18, 0.95);
    }
    #${OVERLAY_IDS.selection} .ifl-label {
      position: absolute;
      top: -26px;
      left: 0;
      background: rgba(15, 23, 42, 0.92);
      color: #fff;
      font: 500 12px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${OVERLAY_IDS.banner} {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.96);
      color: #fff;
      padding: 10px 18px;
      border-radius: 999px;
      font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      letter-spacing: 0.2px;
      pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.22);
    }
    .${OVERLAY_IDS.inlineEditable} {
      outline: 2px dashed rgba(88, 101, 242, 0.8);
      outline-offset: 2px;
      cursor: text !important;
      background: rgba(88, 101, 242, 0.08);
    }
    .${OVERLAY_IDS.inlineEditing} {
      outline-style: solid;
      background: rgba(88, 101, 242, 0.14);
    }
    html.ifl-picking-active, html.ifl-picking-active * { cursor: crosshair !important; }
    html.ifl-refine-mode .${OVERLAY_IDS.inlineEditable},
    html.ifl-refine-mode .${OVERLAY_IDS.inlineEditable} * {
      cursor: text !important;
    }
  `;
  document.head.appendChild(style);
}
