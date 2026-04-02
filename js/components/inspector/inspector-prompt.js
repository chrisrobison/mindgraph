class InspectorPrompt extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Prompt tab placeholder for agent instruction templates.</p>";
  }
}

customElements.define("inspector-prompt", InspectorPrompt);
