import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { uiStore } from "../store/ui-store.js";

const ICON_BY_TOOL = {
  select: "assets/toolbar/select.svg",
  pan: "assets/toolbar/pan.svg",
  "create:note": "assets/toolbar/note2.svg",
  "create:agent": "assets/toolbar/agent.svg",
  "create:data": "assets/toolbar/data.svg",
  "create:transformer": "assets/toolbar/transform.svg",
  "create:view": "assets/toolbar/view.svg",
  "create:action": "assets/toolbar/action.svg",
  connect: "assets/toolbar/connect.svg"
};

const BLACK_COLOR_PATTERN = /^(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

const isBlackColorToken = (value) => BLACK_COLOR_PATTERN.test(String(value ?? "").trim());

const replaceBlackColorTokens = (value) =>
  String(value ?? "")
    .replace(/#000000/gi, "currentColor")
    .replace(/#000\b/gi, "currentColor")
    .replace(/\bblack\b/gi, "currentColor")
    .replace(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/gi, "currentColor");

const ICON_MARKUP_CACHE = new Map();

const normalizeToolbarIconMarkup = (rawSvgMarkup) => {
  const parsed = new DOMParser().parseFromString(rawSvgMarkup, "image/svg+xml");
  const svg = parsed.querySelector("svg");
  if (!svg) return "";

  svg.classList.add("palette-tool-svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  if (!svg.hasAttribute("fill")) {
    svg.setAttribute("fill", "currentColor");
  } else if (isBlackColorToken(svg.getAttribute("fill"))) {
    svg.setAttribute("fill", "currentColor");
  }

  if (svg.hasAttribute("stroke") && isBlackColorToken(svg.getAttribute("stroke"))) {
    svg.setAttribute("stroke", "currentColor");
  }

  svg.querySelectorAll("*").forEach((node) => {
    const fill = node.getAttribute("fill");
    if (fill && fill.toLowerCase() !== "none" && isBlackColorToken(fill)) {
      node.setAttribute("fill", "currentColor");
    }

    const stroke = node.getAttribute("stroke");
    if (stroke && stroke.toLowerCase() !== "none" && isBlackColorToken(stroke)) {
      node.setAttribute("stroke", "currentColor");
    }

    if (node.hasAttribute("style")) {
      node.setAttribute("style", replaceBlackColorTokens(node.getAttribute("style")));
    }
  });

  svg.querySelectorAll("style").forEach((styleNode) => {
    styleNode.textContent = replaceBlackColorTokens(styleNode.textContent);
  });

  return svg.outerHTML;
};

const loadToolbarIconMarkup = async (iconPath) => {
  if (!iconPath) return "";
  if (!ICON_MARKUP_CACHE.has(iconPath)) {
    ICON_MARKUP_CACHE.set(
      iconPath,
      fetch(iconPath)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then((rawMarkup) => normalizeToolbarIconMarkup(rawMarkup))
        .catch(() => "")
    );
  }
  return ICON_MARKUP_CACHE.get(iconPath);
};

const TOOL_GROUPS = [
  {
    title: "Pointer",
    tools: [
      { id: "select", label: "Select" },
      { id: "pan", label: "Pan" }
    ]
  },
  {
    title: "Add Nodes",
    tools: [
      { id: "create:note", label: "Note Node" },
      { id: "create:agent", label: "Agent Node" },
      { id: "create:data", label: "Data Node" },
      { id: "create:transformer", label: "Transformer Node" },
      { id: "create:view", label: "View Node" },
      { id: "create:action", label: "Action Node" }
    ]
  },
  {
    title: "Structure",
    tools: [{ id: "connect", label: "Connect Edge" }]
  }
];

class LeftToolPalette extends HTMLElement {
  #dispose = [];
  #activeTool = "select";
  #iconPaintVersion = 0;

  connectedCallback() {
    this.render();
    void this.#paintToolIcons();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#activeTool = payload?.tool ?? "select";
        this.#syncPressedState();
      })
    );

    this.#syncPressedState();
  }

  async #paintToolIcons() {
    const version = ++this.#iconPaintVersion;
    const iconHosts = Array.from(this.querySelectorAll(".palette-tool-icon[data-icon-src]"));
    if (!iconHosts.length) return;

    const uniqueIconPaths = [...new Set(iconHosts.map((host) => host.dataset.iconSrc).filter(Boolean))];
    const iconMarkupByPath = new Map();

    await Promise.all(
      uniqueIconPaths.map(async (iconPath) => {
        const markup = await loadToolbarIconMarkup(iconPath);
        iconMarkupByPath.set(iconPath, markup);
      })
    );

    if (version !== this.#iconPaintVersion || !this.isConnected) return;

    iconHosts.forEach((host) => {
      const iconPath = host.dataset.iconSrc;
      const markup = iconPath ? iconMarkupByPath.get(iconPath) : "";
      host.innerHTML = markup || "";
    });
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool ?? "select";
        uiStore.setTool(tool);
        publish(EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "info",
          message: `Tool changed to ${tool}`
        });
      });
    });
  }

  #syncPressedState() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      const isActive = button.dataset.tool === this.#activeTool;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  render() {
    const sections = TOOL_GROUPS.map((group) => {
      const buttons = group.tools
        .map(
          (tool) => `
            <button class="palette-tool-btn" type="button" data-tool="${tool.id}" aria-pressed="false" title="${tool.label}" aria-label="${tool.label}">
              <span class="palette-tool-icon" data-icon-src="${ICON_BY_TOOL[tool.id] ?? ""}" aria-hidden="true"></span>
              <span class="palette-tool-label">${tool.label}</span>
            </button>
          `
        )
        .join("");

      return `
        <section class="palette-group">
          <h4>${group.title}</h4>
          <div class="palette-tools">${buttons}</div>
        </section>
      `;
    }).join("");

    this.innerHTML = `
      <aside class="mg-panel palette-panel">
        <header>Tools</header>
        <div class="content palette-content">
          ${sections}
          <section class="palette-shortcuts">
            <h4>Shortcuts</h4>
            <p><kbd>Delete</kbd> remove selected node</p>
            <p><kbd>Cmd/Ctrl+D</kbd> duplicate selected node</p>
            <p><kbd>Cmd/Ctrl+Z</kbd> / <kbd>Shift+Cmd/Ctrl+Z</kbd> undo/redo</p>
            <p><kbd>Shift+Click</kbd> add/remove node in selection</p>
            <p>Drag empty canvas to marquee-select nodes</p>
            <p><kbd>Esc</kbd> reset tool or clear selection</p>
          </section>
        </div>
      </aside>
    `;
  }
}

customElements.define("left-tool-palette", LeftToolPalette);
