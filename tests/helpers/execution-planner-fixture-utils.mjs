import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const fixtureDir = path.join(__dirname, "..", "fixtures", "execution-planner");

export const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

export const listFixtureNames = () => {
  return readdirSync(fixtureDir)
    .filter((fileName) => fileName.endsWith(".input.json"))
    .map((fileName) => fileName.replace(/\.input\.json$/u, ""))
    .sort();
};

const pickNodePlan = (nodePlan) => ({
  runnable: Boolean(nodePlan?.runnable),
  ready: Boolean(nodePlan?.ready),
  blocked: Boolean(nodePlan?.blocked),
  blockedReasons: Array.isArray(nodePlan?.blockedReasons) ? [...nodePlan.blockedReasons] : [],
  contractMissingFields: Array.isArray(nodePlan?.contractMissingFields) ? [...nodePlan.contractMissingFields] : [],
  missingRequiredPorts: Array.isArray(nodePlan?.missingRequiredPorts) ? [...nodePlan.missingRequiredPorts] : [],
  upstreamDependencies: Array.isArray(nodePlan?.upstreamDependencies) ? [...nodePlan.upstreamDependencies] : [],
  dataProviderIds: Array.isArray(nodePlan?.dataProviderIds) ? [...nodePlan.dataProviderIds] : [],
  staleDependencies: Array.isArray(nodePlan?.staleDependencies) ? [...nodePlan.staleDependencies] : [],
  needsRerun: Boolean(nodePlan?.needsRerun),
  isInCycle: Boolean(nodePlan?.isInCycle),
  executionOrderIndex: Number.isInteger(nodePlan?.executionOrderIndex) ? nodePlan.executionOrderIndex : -1
});

export const projectPlan = (plan) => {
  const nodeIds = Object.keys(plan?.nodes ?? {}).sort();
  const nodes = {};
  for (const nodeId of nodeIds) {
    nodes[nodeId] = pickNodePlan(plan.nodes[nodeId]);
  }

  return {
    rootNodeId: plan?.rootNodeId ?? null,
    scopeNodeIds: Array.isArray(plan?.scopeNodeIds) ? [...plan.scopeNodeIds] : [],
    runnableNodeIds: Array.isArray(plan?.runnableNodeIds) ? [...plan.runnableNodeIds] : [],
    readyNodeIds: Array.isArray(plan?.readyNodeIds) ? [...plan.readyNodeIds] : [],
    blockedNodeIds: Array.isArray(plan?.blockedNodeIds) ? [...plan.blockedNodeIds] : [],
    cycles: Array.isArray(plan?.cycles) ? plan.cycles.map((cycle) => (Array.isArray(cycle) ? [...cycle] : cycle)) : [],
    executionOrder: Array.isArray(plan?.executionOrder) ? [...plan.executionOrder] : [],
    nodes
  };
};

export const getFixturePaths = (name) => {
  const inputPath = path.join(fixtureDir, `${name}.input.json`);
  const goldenPath = path.join(fixtureDir, `${name}.golden.json`);
  return { inputPath, goldenPath };
};

const isPlainObject = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const valueRepr = (value) => {
  if (value === undefined) return "<undefined>";
  return JSON.stringify(value);
};

const collectDiffs = (expected, actual, pathLabel, diffs) => {
  if (Object.is(expected, actual)) return;

  const expectedArray = Array.isArray(expected);
  const actualArray = Array.isArray(actual);
  if (expectedArray || actualArray) {
    if (!expectedArray || !actualArray) {
      diffs.push(`${pathLabel}: expected ${valueRepr(expected)} but got ${valueRepr(actual)}`);
      return;
    }

    if (expected.length !== actual.length) {
      diffs.push(`${pathLabel}.length: expected ${expected.length} but got ${actual.length}`);
    }

    const maxLength = Math.max(expected.length, actual.length);
    for (let index = 0; index < maxLength; index += 1) {
      collectDiffs(expected[index], actual[index], `${pathLabel}[${index}]`, diffs);
    }
    return;
  }

  const expectedObject = isPlainObject(expected);
  const actualObject = isPlainObject(actual);
  if (expectedObject || actualObject) {
    if (!expectedObject || !actualObject) {
      diffs.push(`${pathLabel}: expected ${valueRepr(expected)} but got ${valueRepr(actual)}`);
      return;
    }

    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      collectDiffs(expected[key], actual[key], `${pathLabel}.${key}`, diffs);
    }
    return;
  }

  diffs.push(`${pathLabel}: expected ${valueRepr(expected)} but got ${valueRepr(actual)}`);
};

export const assertPlannerSnapshot = (actual, expected, fixtureName) => {
  const diffs = [];
  collectDiffs(expected, actual, "$", diffs);
  if (!diffs.length) return;

  const maxItems = 40;
  const clipped = diffs.slice(0, maxItems);
  const overflow = diffs.length > maxItems ? `\n...and ${diffs.length - maxItems} more difference(s)` : "";

  assert.fail(
    `Planner fixture mismatch for \"${fixtureName}\":\n${clipped.map((line) => `- ${line}`).join("\n")}${overflow}`
  );
};
