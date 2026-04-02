class InspectorTools extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Tools tab placeholder for transformers and utility configuration.</p>";
  }
}

customElements.define("inspector-tools", InspectorTools);
