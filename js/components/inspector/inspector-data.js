class InspectorData extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Data tab placeholder for data-source bindings.</p>";
  }
}

customElements.define("inspector-data", InspectorData);
