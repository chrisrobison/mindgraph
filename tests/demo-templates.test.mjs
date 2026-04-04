import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGraphDocument } from "../js/core/graph-document.js";
import { edgeAffectsDataFlow } from "../js/core/graph-semantics.js";
import { buildExecutionPlan } from "../js/runtime/execution-planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(__dirname, "..", "data", "templates");

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

const templateFiles = readdirSync(templateDir)
  .filter((fileName) => fileName.endsWith(".json"))
  .sort();

test("demo templates are present", () => {
  assert.equal(templateFiles.length, 3, "expected exactly 3 demo templates");
});

for (const fileName of templateFiles) {
  test(`demo template validates: ${fileName}`, () => {
    const document = readJson(path.join(templateDir, fileName));
    const validation = validateGraphDocument(document);
    assert.equal(validation.valid, true, validation.errors.join("; "));

    for (const edge of document.edges ?? []) {
      if (!edgeAffectsDataFlow(edge.type)) continue;
      assert.equal(
        typeof edge?.metadata?.contract,
        "object",
        `expected data-flow edge ${edge.id} to include metadata.contract`
      );
      assert.equal(Boolean(edge.metadata.contract.sourcePort), true, `missing sourcePort on ${edge.id}`);
      assert.equal(Boolean(edge.metadata.contract.targetPort), true, `missing targetPort on ${edge.id}`);
    }
  });
}

test("human approval template emits blocked/ready planner state", () => {
  const document = readJson(path.join(templateDir, "human-approval-blocked-ready.json"));
  const plan = buildExecutionPlan(document);

  assert.equal(plan.readyNodeIds.includes("agent_draft_release"), true);
  assert.equal(plan.blockedNodeIds.includes("agent_release_gate"), true);

  const gateReasons = plan.nodes?.agent_release_gate?.blockedReasons ?? [];
  assert.equal(
    gateReasons.some((reason) => String(reason).includes("Missing input payloads from: data_human_decision")),
    true,
    `expected approval gate to be blocked by missing human decision payload, got: ${gateReasons.join(" | ")}`
  );
});
