class InspectorOutput extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Output tab placeholder for runtime output and reports.</p>";
  }
}

customElements.define("inspector-output", InspectorOutput);
