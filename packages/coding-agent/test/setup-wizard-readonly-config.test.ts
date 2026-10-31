import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { markSetupWizardComplete } from "@oh-my-pi/pi-coding-agent/modes/setup";
import { getProjectAgentDir, logger, TempDir } from "@oh-my-pi/pi-utils";
import * as fileLock from "@oh-my-pi/pi-utils/file-lock";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

/**
 * A home-manager-managed `config.yml` is a symlink into the read-only nix store, so every
 * save fails with EROFS and `Settings.flush()` rethrows it by contract. Setup scenes run
 * inside the TUI, where that rejection surfaced as an unhandled rejection instead of a
 * warning — completing the setup wizard must not depend on the config being writable.
 */
describe("setup wizard completion with an unwritable config", () => {
	let state: SettingsTestState | undefined;
	let tempDir: TempDir;
	let agentDir: string;
	let storeDir: string;
	let projectDir: string;

	beforeEach(() => {
		state = beginSettingsTest();
		tempDir = TempDir.createSync("@pi-setup-readonly-test-");
		agentDir = tempDir.join("agent");
		storeDir = tempDir.join("store");
		projectDir = tempDir.join("project");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(storeDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
		// The OS lock needs the native module; this test is about the write failing,
		// not about lock contention.
		vi.spyOn(fileLock, "withFileLock").mockImplementation(async (_filePath, fn) => await fn());
	});

	afterEach(async () => {
		// Restore write permission before removing the tree.
		try {
			fs.chmodSync(storeDir, 0o755);
		} catch {}
		restoreSettingsTestState(state);
		state = undefined;
		await Bun.sleep(0);
		await tempDir?.remove();
	});

	it("warns instead of rejecting when the config cannot be written", async () => {
		const warnSpy = vi.spyOn(logger, "warn");
		const storeConfig = path.join(storeDir, "config.yml");
		await Bun.write(storeConfig, "startup:\n  quiet: true\n");
		const configLink = path.join(agentDir, "config.yml");
		fs.symlinkSync(storeConfig, configLink);

		const settings = await Settings.init({ cwd: projectDir, agentDir });
		// The fixture must still mirror home-manager after init, or the test proves nothing.
		expect(fs.lstatSync(configLink).isSymbolicLink()).toBe(true);
		fs.chmodSync(storeDir, 0o555);

		await markSetupWizardComplete(settings, 1234);

		// Nothing reached the store, and the failure was reported rather than thrown.
		expect(await Bun.file(storeConfig).text()).toBe("startup:\n  quiet: true\n");
		const warning = warnSpy.mock.calls.find(([message]) => message === "Setup: failed to persist settings");
		expect(warning).toBeDefined();
		// EROFS on a real nix store; EACCES when the directory is merely unwritable.
		expect(String((warning?.[1] as { error?: string } | undefined)?.error)).toMatch(/(EROFS|EACCES).*config\.yml/);
	});
});
