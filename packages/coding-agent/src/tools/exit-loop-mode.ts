import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { prompt } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import exitLoopModeDescription from "../prompts/tools/exit-loop-mode.md" with { type: "text" };
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

const exitLoopModeSchema = Type.Object({
	summary: Type.Optional(Type.String({ description: "Brief summary of what was accomplished" })),
});

type ExitLoopModeParams = typeof exitLoopModeSchema.static;

export interface ExitLoopModeDetails {
	summary?: string;
}

export class ExitLoopModeTool implements AgentTool<typeof exitLoopModeSchema, ExitLoopModeDetails> {
	readonly name = "exit_loop_mode";
	readonly label = "ExitLoopMode";
	readonly description: string;
	readonly parameters = exitLoopModeSchema;
	readonly strict = true;
	readonly concurrency = "exclusive";
	readonly intent = (): string => "exit loop";

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(exitLoopModeDescription);
	}

	async execute(
		_toolCallId: string,
		params: ExitLoopModeParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ExitLoopModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ExitLoopModeDetails>> {
		if (!this.session.isLoopModeEnabled?.()) {
			throw new ToolError("Loop mode is not active.");
		}

		return {
			content: [
				{
					type: "text",
					text: params.summary ? `Loop mode exited. ${params.summary}` : "Loop mode exited. All work is complete.",
				},
			],
			details: {
				summary: params.summary,
			},
		};
	}
}
