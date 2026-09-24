import { expect, test } from "bun:test";
import { validateProviderConfiguration } from "@oh-my-pi/pi-coding-agent/config/models-config";

const customModelProvider = {
	baseUrl: "https://example.com",
	api: "anthropic-messages" as const,
	models: [{ id: "custom-model" }],
};

test("accepts OAuth-backed custom models for the built-in Anthropic provider without an API key", () => {
	expect(() =>
		validateProviderConfiguration("anthropic", { ...customModelProvider, auth: "oauth" }, "models-config"),
	).not.toThrow();
});

test("rejects Anthropic custom models without an auth mode or API key", () => {
	expect(() => validateProviderConfiguration("anthropic", customModelProvider, "models-config")).toThrow(
		'Provider anthropic: "apiKey" is required when defining custom models unless auth is "none" or the built-in anthropic provider uses "auth: oauth".',
	);
});

test("rejects OAuth-backed custom models for other providers without an API key", () => {
	expect(() =>
		validateProviderConfiguration("custom-provider", { ...customModelProvider, auth: "oauth" }, "models-config"),
	).toThrow(
		'Provider custom-provider: "apiKey" is required when defining custom models unless auth is "none" or the built-in anthropic provider uses "auth: oauth".',
	);
});
