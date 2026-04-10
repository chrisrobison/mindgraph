class AppShell extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <main id="app" class="mg-shell">
        <top-toolbar class="mg-toolbar"></top-toolbar>
        <graph-canvas class="mg-canvas"></graph-canvas>
        <div id="bottom-row" class="mg-bottom-row">
          <bottom-activity-panel class="mg-activity"></bottom-activity-panel>
          <left-tool-palette class="mg-palette"></left-tool-palette>
        </div>
        <inspector-panel class="mg-inspector"></inspector-panel>
      </main>
    `;
  }
}

customElements.define("app-shell", AppShell);
