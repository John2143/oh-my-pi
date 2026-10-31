import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";

import { prompt } from "@oh-my-pi/pi-utils";

import exitLoopModeDescription from "../prompts/tools/exit-loop-mode.md" with { type: "text" };

import type { ToolSession } from "./index";

import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";

const exitLoopModeSchema = type({
	"summary?": type("string").describe("brief summary of the completed work"),
	"+": "reject",
}).describe("exit loop mode arguments");

type ExitLoopModeParams = typeof exitLoopModeSchema.infer;

export interface ExitLoopModeDetails {
	summary?: string;
}

/**
 * Lets the agent end its own `/loop` once it decides the work is complete.
 * Registered hidden and inactive; loop mode activates it by name, and a
 * successful call tears loop mode down through the tool-completion handler.
 */
export class ExitLoopModeTool implements AgentTool<typeof exitLoopModeSchema, ExitLoopModeDetails> {
	readonly name = "exit_loop_mode";
	readonly approval = "read" as const;
	readonly label = "ExitLoopMode";
	readonly summary = "Exit loop mode";
	readonly description: string;
	readonly parameters = exitLoopModeSchema;
	readonly strict = true;
	/** Ending the loop reshapes the next turn, so it never shares a batch. */
	readonly concurrency = "exclusive" as const;
	readonly #session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
		this.description = prompt.render(exitLoopModeDescription);
	}

	async execute(
		_toolCallId: string,
		params: ExitLoopModeParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ExitLoopModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ExitLoopModeDetails>> {
		if (!this.#session.isLoopModeEnabled?.()) {
			throw new ToolError("Loop mode is not active.");
		}
		return {
			content: [
				{
					type: "text",
					text: params.summary ? `Loop mode exited. ${params.summary}` : "Loop mode exited. All work is complete.",
				},
			],
			details: { summary: params.summary },
		};
	}
}
