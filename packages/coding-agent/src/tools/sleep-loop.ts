import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { prompt } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import sleepLoopDescription from "../prompts/tools/sleep-loop.md" with { type: "text" };
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

const sleepLoopSchema = Type.Object({
	duration: Type.String({
		description: "How long to sleep (e.g. '5min', '30s', '2h', '1h30m')",
		examples: ["5min", "30s", "2h", "1h30m"],
	}),
	reason: Type.Optional(Type.String({ description: "Why the agent is sleeping (for future invocation context)" })),
});

type SleepLoopParams = typeof sleepLoopSchema.static;

export interface SleepLoopDetails {
	duration: string;
	durationMs: number;
	reason?: string;
}

/**
 * Parse a human-readable duration string into milliseconds.
 * Supports formats: "5min", "30s", "2h", "1h30m", plain numbers (seconds).
 */
function parseDuration(input: string): number {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new ToolError("Duration must not be empty.");
	}

	// Plain number → seconds
	if (/^\d+$/.test(trimmed)) {
		return parseInt(trimmed, 10) * 1000;
	}

	let totalMs = 0;
	const pattern = /(\d+)\s*(h|m|s|min)/gi;
	let match: RegExpExecArray | null;
	let matched = false;

	// biome-ignore lint/suspicious/noAssignInExpressions: standard RegExp.exec loop pattern
	while ((match = pattern.exec(trimmed)) !== null) {
		matched = true;
		const value = parseInt(match[1], 10);
		const unit = match[2].toLowerCase();

		switch (unit) {
			case "h":
				totalMs += value * 3600_000;
				break;
			case "m":
			case "min":
				totalMs += value * 60_000;
				break;
			case "s":
				totalMs += value * 1000;
				break;
		}
	}

	if (!matched) {
		throw new ToolError(`Invalid duration format: "${input}". Use formats like "5min", "30s", "2h", or "1h30m".`);
	}

	if (totalMs <= 0) {
		throw new ToolError(`Duration must be positive: "${input}" resolves to ${totalMs}ms.`);
	}

	return totalMs;
}

export class SleepLoopTool implements AgentTool<typeof sleepLoopSchema, SleepLoopDetails> {
	readonly name = "sleep";
	readonly label = "SleepLoop";
	readonly description: string;
	readonly parameters = sleepLoopSchema;
	readonly strict = true;
	readonly concurrency = "exclusive";
	readonly intent = (): string => "sleep";

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(sleepLoopDescription);
	}

	async execute(
		_toolCallId: string,
		params: SleepLoopParams,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SleepLoopDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SleepLoopDetails>> {
		if (!this.session.isLoopModeEnabled?.()) {
			throw new ToolError("Loop mode is not active.");
		}

		const durationMs = parseDuration(params.duration);
		const reasonText = params.reason ? ` Reason: ${params.reason}` : "";

		return {
			content: [{ type: "text", text: `Sleeping for ${params.duration}.${reasonText}` }],
			details: {
				duration: params.duration,
				durationMs,
				reason: params.reason,
			},
		};
	}
}
