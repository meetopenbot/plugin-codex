import {
  definePlugin,
  shouldHandleInvoke,
  agentOutput,
} from "@meetopenbot/plugin-sdk";
import {
  Codex,
  type ApprovalMode,
  type SandboxMode,
  type Thread,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk";

export default definePlugin({
  id: "codex",
  name: "Codex",
  description: "Codex integration tools for OpenBot",
  configSchema: {
    type: "object",
    properties: {
      apiKey: { type: "string", description: "Codex API Key", format: "password" },
      baseURL: { type: "string", description: "Custom OpenAI-compatible endpoint" },
      codexPathOverride: { type: "string", description: "Path to codex CLI" },
      model: { type: "string", description: "Model to use", default: "gpt-5-codex" },
      workingDirectory: { type: "string", description: "Working directory for Codex" },
      skipGitRepoCheck: { type: "boolean", description: "Skip git repo check", default: true },
      sandboxMode: {
        type: "string",
        enum: ["workspace-read", "workspace-write", "full-read", "full-write"],
        description: "Sandbox mode",
        default: "workspace-write",
      },
      approvalPolicy: {
        type: "string",
        enum: ["always", "never", "automatic"],
        description: "Approval policy",
        default: "never",
      },
      networkAccessEnabled: { type: "boolean", description: "Enable network access" },
      webSearchMode: {
        type: "string",
        enum: ["always", "never", "automatic"],
        description: "Web search mode",
      },
    },
  },
  factory: (context) => {
    const config = context.config as any;
    const env = (globalThis as any)?.process?.env || {};

    const apiKey = config.apiKey ?? env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
    const codexPathOverride = config.codexPathOverride ?? env.CODEX_PATH ?? env.CODEX_CLI_PATH;
    const model = config.model?.split("/").pop() || "gpt-5-codex";

    /** Lazily constructed to avoid throwing during registration if CLI is missing. */
    let client: Codex | undefined;
    const getClient = () => {
      if (!client) {
        client = new Codex({
          apiKey,
          ...(codexPathOverride && { codexPathOverride }),
          ...(config.baseURL && { baseUrl: config.baseURL }),
        });
      }
      return client;
    };

    let thread: Thread | null = null;
    const getThread = (state?: any, meta?: any) => {
      if (thread) return thread;

      const workingDirectory =
        config.workingDirectory ||
        state?.channelDetails?.cwd ||
        (globalThis as any)?.process?.cwd() ||
        "/tmp";

      const threadOptions: ThreadOptions = {
        model,
        workingDirectory,
        skipGitRepoCheck: config.skipGitRepoCheck ?? true,
        sandboxMode: (config.sandboxMode as SandboxMode) ?? "workspace-write",
        approvalPolicy: (config.approvalPolicy as ApprovalMode) ?? "never",
        ...(typeof config.networkAccessEnabled === "boolean" && {
          networkAccessEnabled: config.networkAccessEnabled,
        }),
        ...(config.webSearchMode && {
          webSearchMode: config.webSearchMode as WebSearchMode,
        }),
      };

      const threadId = state?.threadId || meta?.threadId;
      thread = threadId
        ? getClient().resumeThread(threadId, threadOptions)
        : getClient().startThread(threadOptions);

      if (!threadId && state) {
        state.threadId = thread.id;
      }

      return thread;
    };

    return (builder) => {
      builder.on("agent:invoke", async function* (event, ctx) {
        if (!shouldHandleInvoke(event, context.agentId)) return;

        const { content } = event.data || {};
        if (!content) {
          yield agentOutput({
            agentId: context.agentId,
            content: "No content provided.",
            threadId: event.meta?.threadId,
          });
          return;
        }

        try {
          const turn = await getThread(ctx?.state, event.meta).runStreamed(content);
          for await (const chunk of turn.events) {
            if (chunk.type === "item.completed") {
              let outputContent = "";
              if (chunk.item.type === "agent_message") {
                outputContent = chunk.item.text;
              } else if (chunk.item.type === "reasoning") {
                outputContent = chunk.item.text;
              } else if (chunk.item.type === "command_execution") {
                outputContent = `Executing: ${chunk.item.command}`;
              } else if (chunk.item.type === "file_change") {
                outputContent = chunk.item.changes
                  .map((change: any) => `${change.path}: ${change.action}`)
                  .join("\n");
              } else if (chunk.item.type === "error") {
                outputContent = `Error: ${chunk.item.message}`;
              } else if (chunk.item.type === "todo_list") {
                outputContent = chunk.item.items
                  .map(
                    (item: any) =>
                      `- ${item.text} (${item.completed ? "completed" : "pending"})`
                  )
                  .join("\n");
              } else if (chunk.item.type === "web_search") {
                outputContent = `Searching: ${chunk.item.query}`;
              }

              if (outputContent) {
                yield agentOutput({
                  agentId: context.agentId,
                  content: outputContent,
                  threadId: event.meta?.threadId,
                });
              }
            }
          }
        } catch (error: any) {
          yield agentOutput({
            agentId: context.agentId,
            content: `Error: ${error?.message || "Codex request failed."}`,
            threadId: event.meta?.threadId,
          });
        }
      });
    };
  },
});
