class InspectorActivity extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Activity tab placeholder for node-level event history.</p>";
  }
}

customElements.define("inspector-activity", InspectorActivity);
