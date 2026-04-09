export const DEMO_TEMPLATES = Object.freeze([
  {
    id: "research-synthesize-brief-publish",
    title: "Reservation Intake -> Mutate",
    description:
      "A reservation request trigger and customer query feed a payload builder, then terminate in a U2OS mutate write operation.",
    fileName: "research-synthesize-brief-publish.json"
  },
  {
    id: "data-ingest-normalize-analyze-dashboard",
    title: "Customer Notification -> Emit",
    description:
      "Customer update + reservation context feed a composed payload that terminates in a U2OS emit event action.",
    fileName: "data-ingest-normalize-analyze-dashboard.json"
  },
  {
    id: "human-approval-blocked-ready",
    title: "Human Approval Gate",
    description:
      "Shows planner blocked/ready behavior when a human decision payload is required before final publish.",
    fileName: "human-approval-blocked-ready.json"
  }
]);

const templateById = new Map(DEMO_TEMPLATES.map((template) => [template.id, template]));

export const getDemoTemplateById = (templateId) => templateById.get(String(templateId ?? "")) ?? null;

export const loadDemoTemplateDocument = async (templateId) => {
  const template = getDemoTemplateById(templateId);
  if (!template) {
    throw new Error(`Unknown demo template: ${templateId}`);
  }

  const url = new URL(`../../data/templates/${template.fileName}`, import.meta.url);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load template ${template.title}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error(`Template ${template.title} returned an invalid document payload`);
  }

  return payload;
};
