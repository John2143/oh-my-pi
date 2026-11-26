import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { isAcpBuiltinShadowedName } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import {
	executeBuiltinSlashCommand,
	resolveBuiltinInvocation,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

describe("hint namespaces own their colon form", () => {
	it("leaves the hint namespaces to the model", () => {
		for (const text of ["/agent:scout", "/model:opus", "/local:plans/x.md"]) {
			expect(resolveBuiltinInvocation(text)).toBeUndefined();
		}
	});

	it("keeps colon-as-argument for every other command", () => {
		for (const text of ["/switch:sonnet", "/move:notes", "/git:status", "/btw:quick one", "/effort:high"]) {
			const resolved = resolveBuiltinInvocation(text);
			expect(resolved?.parsed.name).toBe(text.slice(1, text.indexOf(":")));
			expect(resolved?.parsed.args).toBe(text.slice(text.indexOf(":") + 1));
		}
	});

	it("still resolves the space forms", () => {
		for (const text of ["/local x", "/switch x", "/move x", "/git x"]) {
			expect(resolveBuiltinInvocation(text)?.command.name).toBe(text.slice(1, text.indexOf(" ")));
		}
	});

	it("keeps `/force:bash` dispatchable", () => {
		expect(resolveBuiltinInvocation("/force:bash")?.parsed.args).toBe("bash");
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
				composer: { setText: vi.fn() } as unknown as InteractiveModeContext["composer"],
				session: { setForcedToolChoice } as unknown as InteractiveModeContext["session"],
				showStatus: vi.fn(),
				showError: vi.fn(),
			} as unknown as InteractiveModeContext,
		};

		expect(await executeBuiltinSlashCommand("/force:bash", runtime)).toBe(true);
		expect(setForcedToolChoice).toHaveBeenCalledWith("bash");
	});

	it("advertises colon-namespaced extension commands unless a builtin captures them", () => {
		// `/model:foo` is prose (hint namespace), so the extension keeps its name.
		expect(isAcpBuiltinShadowedName("model:foo")).toBe(false);
		// `/switch:foo` still dispatches to `/switch`, which takes arguments.
		expect(isAcpBuiltinShadowedName("switch:foo")).toBe(true);
		expect(isAcpBuiltinShadowedName("force:bash")).toBe(true);
	});
});
