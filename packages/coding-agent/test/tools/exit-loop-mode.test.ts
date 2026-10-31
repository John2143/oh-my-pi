import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ExitLoopModeTool } from "@oh-my-pi/pi-coding-agent/tools/exit-loop-mode";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionSpawns: () => "*",
		getSessionFile: () => null,
		settings: Settings.isolated(),
		...overrides,
	};
}

describe("ExitLoopModeTool", () => {
	it("refuses to run when loop mode is off", async () => {
		const tool = new ExitLoopModeTool(createSession({ isLoopModeEnabled: () => false }));

		await expect(tool.execute("call-1", {})).rejects.toThrow("Loop mode is not active.");
	});

	it("reports the agent's summary and passes it through details", async () => {
		const tool = new ExitLoopModeTool(createSession({ isLoopModeEnabled: () => true }));

		const result = await tool.execute("call-2", { summary: "done" });

		expect(result.content).toEqual([{ type: "text", text: "Loop mode exited. done" }]);
		expect(result.details).toEqual({ summary: "done" });
	});

	it("falls back to a completion message when no summary is given", async () => {
		const tool = new ExitLoopModeTool(createSession({ isLoopModeEnabled: () => true }));

		const result = await tool.execute("call-3", {});

		expect(result.content).toEqual([{ type: "text", text: "Loop mode exited. All work is complete." }]);
		expect(result.details).toEqual({ summary: undefined });
	});
});
