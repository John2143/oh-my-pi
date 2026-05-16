import { describe, expect, it } from "bun:test";
import type { ToolSession } from "../../src/tools";
import { createTools, HIDDEN_TOOLS } from "../../src/tools";

function mockSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: process.cwd(),
		hasUI: false,
		settings: {
			get: () => undefined,
		} as any,
		isLoopModeEnabled: () => false,
		...overrides,
	};
}

describe("loop mode tools", () => {
	it("exit_loop_mode is in HIDDEN_TOOLS", () => {
		const names = Object.keys(HIDDEN_TOOLS);
		expect(names).toContain("exit_loop_mode");
	});

	it("NOT in createTools output when loop mode is off", async () => {
		// createTools only includes it when loop mode is on.
		// SDK registers it separately in the tool registry for mid-session activation.
		const tools = await createTools(mockSession({ isLoopModeEnabled: () => false }));
		const names = tools.map(t => t.name);
		expect(names).not.toContain("exit_loop_mode");
	});

	it("IS in createTools output when loop mode is on", async () => {
		const tools = await createTools(mockSession({ isLoopModeEnabled: () => true }));
		const names = tools.map(t => t.name);
		expect(names).toContain("exit_loop_mode");
	});

	it("exit_loop_mode has exclusive concurrency", async () => {
		const tools = await createTools(mockSession({ isLoopModeEnabled: () => true }));
		const tool = tools.find(t => t.name === "exit_loop_mode")!;
		expect(tool).toBeDefined();
		expect(tool.name).toBe("exit_loop_mode");
		expect(tool.concurrency).toBe("exclusive");
	});
});
