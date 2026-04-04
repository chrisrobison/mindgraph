import { writeFileSync } from "node:fs";

import { buildExecutionPlan } from "../../js/runtime/execution-planner.js";
import {
  getFixturePaths,
  listFixtureNames,
  projectPlan,
  readJson
} from "./execution-planner-fixture-utils.mjs";

const fixtureNames = listFixtureNames();
if (!fixtureNames.length) {
  throw new Error("No execution planner fixtures found");
}

for (const fixtureName of fixtureNames) {
  const { inputPath, goldenPath } = getFixturePaths(fixtureName);
  const fixture = readJson(inputPath);
  const plan = buildExecutionPlan(fixture.document, fixture.options ?? {});
  const projected = projectPlan(plan);
  writeFileSync(goldenPath, `${JSON.stringify(projected, null, 2)}\n`, "utf8");
}

console.log(`Generated ${fixtureNames.length} planner golden fixture(s)`);
