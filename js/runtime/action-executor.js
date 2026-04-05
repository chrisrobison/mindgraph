import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};
const toObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const makeId = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

const commandHandlers = new Map();

const buildDefaultCommandResult = ({ command, actionId, commandInput, config }) => {
  const resultId = makeId("cmd");
  return {
    status: "ok",
    exitCode: 0,
    stdout: `Executed ${command}`,
    stderr: "",
    payload: {
      resultId,
      actionId,
      command,
      channel: asText(config.channel || config.queue, "default"),
      receivedAt: new Date().toISOString(),
      commandInput
    }
  };
};

const registerDefaultHandlers = () => {
  commandHandlers.set("open_approval_ticket", ({ actionId, commandInput, config }) => {
    const ticketId = `APR-${Math.floor(100 + Math.random() * 900)}`;
    return {
      status: "ok",
      exitCode: 0,
      stdout: `Opened approval ticket ${ticketId}`,
      stderr: "",
      payload: {
        ticketId,
        actionId,
        queue: asText(config.queue, "approvals"),
        slaHours: Number(config.slaHours ?? 4),
        approvalStatus: "pending_human_approval",
        commandInput
      }
    };
  });

  commandHandlers.set("enqueue_campaign_brief", ({ actionId, commandInput, config }) => {
    const queueItemId = makeId("brief");
    return {
      status: "ok",
      exitCode: 0,
      stdout: `Queued campaign brief ${queueItemId}`,
      stderr: "",
      payload: {
        queueItemId,
        actionId,
        channel: asText(config.channel, "launch_ops_queue"),
        priority: asText(config.priority, "normal"),
        commandInput
      }
    };
  });

  commandHandlers.set("publish_release_artifacts", ({ actionId, commandInput, config }) => {
    const releaseId = makeId("rel");
    return {
      status: "ok",
      exitCode: 0,
      stdout: `Published release artifacts ${releaseId}`,
      stderr: "",
      payload: {
        releaseId,
        actionId,
        channel: asText(config.channel, "release-bus"),
        requireHumanApproval: Boolean(config.requireHumanApproval),
        commandInput
      }
    };
  });

  commandHandlers.set("publish_campaign_brief", ({ actionId, commandInput, config }) => {
    const publishId = makeId("pub");
    return {
      status: "ok",
      exitCode: 0,
      stdout: `Published campaign brief ${publishId}`,
      stderr: "",
      payload: {
        publishId,
        actionId,
        channel: asText(config.channel, "launch_ops_queue"),
        commandInput
      }
    };
  });
};

registerDefaultHandlers();

export const registerActionCommandHandler = (command, handler) => {
  const key = asText(command).toLowerCase();
  if (!key || typeof handler !== "function") return;
  commandHandlers.set(key, handler);
};

export const unregisterActionCommandHandler = (command) => {
  const key = asText(command).toLowerCase();
  if (!key) return;
  commandHandlers.delete(key);
};

const buildCommandInput = (input = {}) => {
  const explicit = toObject(input.commandInput);
  if (Object.keys(explicit).length) return explicit;

  const providers = toArray(input.providers).map((provider) => ({
    id: provider?.id ?? null,
    label: provider?.label ?? "",
    type: provider?.type ?? ""
  }));

  const dependencies = toArray(input.dependencies).map((dependency) => ({
    id: dependency?.id ?? null,
    label: dependency?.label ?? "",
    status: dependency?.status ?? ""
  }));

  return {
    providerCount: providers.length,
    dependencyCount: dependencies.length,
    providers,
    dependencies
  };
};

const summarize = ({ actionLabel, command, commandResult }) => {
  const status = asText(commandResult?.status, "ok");
  if (status !== "ok") return `${actionLabel} command ${command} failed`;
  return `${actionLabel} executed ${command}`;
};

export const actionExecutor = {
  execute(actionOrId, input = {}) {
    const action = actionOrId && typeof actionOrId === "object" ? actionOrId : null;
    const actionId = asText(action?.id ?? actionOrId, "action_unknown");
    const actionLabel = asText(action?.label, actionId);
    const command = asText(action?.data?.command ?? input.command, "noop").toLowerCase();
    const config = toObject(action?.data?.config ?? input.config);
    const commandInput = buildCommandInput(input);
    const handler = commandHandlers.get(command);
    const commandResult = toObject(
      handler
        ? handler({
            action: action ?? null,
            actionId,
            command,
            config,
            commandInput,
            input
          })
        : buildDefaultCommandResult({ command, actionId, commandInput, config })
    );
    const summary = summarize({ actionLabel, command, commandResult });
    const entry = {
      actionId,
      command,
      input,
      config,
      commandInput,
      commandResult,
      summary,
      executedAt: new Date().toISOString()
    };

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Action executed: ${actionLabel} (${command})`,
      context: {
        actionId,
        command
      }
    });

    return entry;
  }
};
