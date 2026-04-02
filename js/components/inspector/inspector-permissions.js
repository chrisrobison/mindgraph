class InspectorPermissions extends HTMLElement {
  connectedCallback() {
    this.innerHTML = "<p>Permissions tab placeholder for policy and access controls.</p>";
  }
}

customElements.define("inspector-permissions", InspectorPermissions);
