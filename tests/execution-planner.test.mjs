import test from "node:test";

import { buildExecutionPlan } from "../js/runtime/execution-planner.js";
import {
  assertPlannerSnapshot,
  getFixturePaths,
  listFixtureNames,
  projectPlan,
  readJson
} from "./helpers/execution-planner-fixture-utils.mjs";

const fixtureNames = listFixtureNames();

test("execution planner fixtures are discoverable", () => {
  if (!fixtureNames.length) {
    throw new Error("No execution planner fixtures found");
  }
});

for (const fixtureName of fixtureNames) {
  test(`execution planner fixture: ${fixtureName}`, () => {
    const { inputPath, goldenPath } = getFixturePaths(fixtureName);
    const fixture = readJson(inputPath);
    const expected = readJson(goldenPath);

    const actual = projectPlan(buildExecutionPlan(fixture.document, fixture.options ?? {}));
    assertPlannerSnapshot(actual, expected, fixtureName);

    if (fixtureName === "execution-order-index-stability") {
      const second = projectPlan(buildExecutionPlan(fixture.document, fixture.options ?? {}));
      assertPlannerSnapshot(second, actual, `${fixtureName} (repeat run stability)`);
    }
  });
}
