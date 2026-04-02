class InspectorOverview extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Overview tab placeholder for selected node summary.</p>";
  }
}

customElements.define("inspector-overview", InspectorOverview);
