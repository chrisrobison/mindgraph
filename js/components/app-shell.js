class AppShell extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    this.innerHTML = `
      <main class="mg-shell">
        <top-toolbar class="mg-toolbar"></top-toolbar>
        <left-tool-palette class="mg-palette"></left-tool-palette>
        <graph-canvas class="mg-canvas"></graph-canvas>
        <inspector-panel class="mg-inspector"></inspector-panel>
        <bottom-activity-panel class="mg-activity"></bottom-activity-panel>
      </main>
    `;
  }
}

customElements.define("app-shell", AppShell);
