export const DEMO_TEMPLATES = Object.freeze([
  {
    id: "research-synthesize-brief-publish",
    title: "Research -> Brief -> Publish",
    description:
      "Market research and policy context flow into synthesis, executive brief generation, and CMS publish action.",
    fileName: "research-synthesize-brief-publish.json"
  },
  {
    id: "data-ingest-normalize-analyze-dashboard",
    title: "Ingest -> Normalize -> Analyze -> Dashboard",
    description:
      "Telemetry ingest is normalized, analyzed with business dimensions, then rendered into a KPI dashboard model.",
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
