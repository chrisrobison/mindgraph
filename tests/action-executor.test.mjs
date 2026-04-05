import assert from "node:assert/strict";
import test from "node:test";

import { EVENTS } from "../js/core/event-constants.js";
import { subscribe } from "../js/core/pan.js";
import {
  actionExecutor,
  registerActionCommandHandler,
  unregisterActionCommandHandler
} from "../js/runtime/action-executor.js";

test("actionExecutor returns normalized command result for known commands", () => {
  const entry = actionExecutor.execute(
    {
      id: "action_publish",
      label: "Publish to CMS Queue",
      data: {
        command: "enqueue_campaign_brief",
        config: {
          channel: "launch_ops_queue",
          priority: "high"
        }
      }
    },
    {
      providers: [{ id: "view_exec_brief", label: "Render Brief", payload: { title: "Q2 Launch" } }],
      dependencies: [{ id: "agent_brief", label: "Draft Brief", status: "completed", output: { ok: true } }]
    }
  );

  assert.equal(entry.actionId, "action_publish");
  assert.equal(entry.command, "enqueue_campaign_brief");
  assert.equal(entry.commandResult.status, "ok");
  assert.equal(entry.commandResult.exitCode, 0);
  assert.equal(entry.commandResult.payload.channel, "launch_ops_queue");
  assert.equal(entry.commandInput.providerCount, 1);
  assert.equal(entry.commandInput.dependencyCount, 1);
  assert.match(entry.summary, /executed enqueue_campaign_brief/i);
});

test("actionExecutor allows custom command handlers", () => {
  const command = "custom_webhook";

  registerActionCommandHandler(command, ({ commandInput }) => ({
    status: "ok",
    exitCode: 0,
    stdout: "Custom handler executed",
    stderr: "",
    payload: {
      accepted: true,
      inputKeys: Object.keys(commandInput)
    }
  }));

  try {
    const entry = actionExecutor.execute(
      {
        id: "action_custom",
        label: "Custom Action",
        data: {
          command
        }
      },
      {
        commandInput: {
          foo: "bar"
        }
      }
    );

    assert.equal(entry.commandResult.status, "ok");
    assert.equal(entry.commandResult.payload.accepted, true);
    assert.deepEqual(entry.commandResult.payload.inputKeys, ["foo"]);
  } finally {
    unregisterActionCommandHandler(command);
  }
});

test("actionExecutor appends activity log event", () => {
  const seen = [];
  const off = subscribe(EVENTS.ACTIVITY_LOG_APPENDED, ({ payload }) => {
    seen.push(payload);
  });

  try {
    actionExecutor.execute({
      id: "action_noop",
      label: "Noop Action",
      data: {
        command: "noop"
      }
    });
  } finally {
    off();
  }

  assert.equal(seen.length > 0, true);
  const last = seen.at(-1);
  assert.match(last.message, /Action executed: Noop Action \(noop\)/);
});
