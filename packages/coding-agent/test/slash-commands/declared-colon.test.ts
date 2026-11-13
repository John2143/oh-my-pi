import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { isAcpBuiltinShadowedName } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import {
	executeBuiltinSlashCommand,
	resolveBuiltinInvocation,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

describe("colon-form arguments are opt-in", () => {
	it("leaves colon forms of commands that do not declare them to the model", () => {
		for (const text of ["/local:x", "/switch:x", "/move:x", "/git:x", "/queue:x"]) {
			expect(resolveBuiltinInvocation(text)).toBeUndefined();
		}
	});

	it("still resolves the space forms", () => {
		for (const text of ["/local x", "/switch x", "/move x", "/git x"]) {
			expect(resolveBuiltinInvocation(text)?.command.name).toBe(text.slice(1, text.indexOf(" ")));
		}
	});

	it("keeps a declared colon alias dispatchable", () => {
		expect(resolveBuiltinInvocation("/force:bash")?.parsed.args).toBe("bash");
	});

	it("advertises colon-namespaced extension commands only where a builtin declares the form", () => {
		expect(isAcpBuiltinShadowedName("model:foo")).toBe(false);
		expect(isAcpBuiltinShadowedName("force:bash")).toBe(true);
	});

	it("does not dispatch `/local:x` as the `/local` command", async () => {
		const showStatus = vi.fn();
		const runtime = { ctx: { showStatus } as unknown as InteractiveModeContext };

		expect(await executeBuiltinSlashCommand("/local:x", runtime)).toBe(false);
		expect(showStatus).not.toHaveBeenCalled();
	});

	it("dispatches `/force:bash`", async () => {
		const setForcedToolChoice = vi.fn();
		const runtime = {
			ctx: {
				editor: { setText: vi.fn() } as unknown as InteractiveModeContext["editor"],
				session: { setForcedToolChoice } as unknown as InteractiveModeContext["session"],
				showStatus: vi.fn(),
				showError: vi.fn(),
			} as unknown as InteractiveModeContext,
		};

		expect(await executeBuiltinSlashCommand("/force:bash", runtime)).toBe(true);
		expect(setForcedToolChoice).toHaveBeenCalledWith("bash");
	});
});
