class InspectorAutomation extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Automation tab placeholder for schedules and triggers.</p>";
  }
}

customElements.define("inspector-automation", InspectorAutomation);
