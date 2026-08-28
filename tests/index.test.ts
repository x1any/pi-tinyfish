import type { FetchResponse, SearchQueryResponse } from "@tiny-fish/sdk";
import { describe, expect, test } from "vitest";
import {
	formatFetchResponse,
	formatSearchResponse,
	normalizeUrls,
	parseTinyfishApiKey,
	truncateToolText,
} from "../index.ts";

describe("pi-tinyfish helpers", () => {
	test("parseTinyfishApiKey reads and trims saved key", () => {
		expect(parseTinyfishApiKey('{"apiKey":" tf_test "}')).toBe("tf_test");
		expect(parseTinyfishApiKey('{"apiKey":" "}')).toBeUndefined();
	});

	test("normalizeUrls trims, combines, and deduplicates url inputs", () => {
		expect(
			normalizeUrls({
				url: " https://example.com ",
				urls: ["https://example.com", "https://tinyfish.ai", ""],
			}),
		).toEqual(["https://example.com", "https://tinyfish.ai"]);
	});

	test("formatSearchResponse renders ranked results", () => {
		const response: SearchQueryResponse = {
			query: "TinyFish SDK",
			page: 0,
			total_results: 1,
			results: [
				{
					position: 1,
					site_name: "docs.tinyfish.ai",
					title: "TinyFish Docs",
					snippet: "TinyFish developer documentation",
					url: "https://docs.tinyfish.ai/",
				},
			],
		};

		const text = formatSearchResponse(response, {
			location: "US",
			language: "en",
		});
		expect(text).toContain("# TinyFish Search");
		expect(text).toContain("## 1. TinyFish Docs");
		expect(text).toContain("URL: https://docs.tinyfish.ai/");
		expect(text).toContain("Location: US");
	});

	test("formatFetchResponse renders page content and per-url errors", () => {
		const response: FetchResponse = {
			results: [
				{
					url: "https://example.com",
					final_url: "https://example.com/",
					title: "Example Domain",
					description: "Example description",
					language: "en",
					author: null,
					published_date: null,
					format: "markdown",
					text: "# Example Domain\n\nHello from TinyFish.",
				},
			],
			errors: [{ url: "https://bad.invalid", error: "fetch_error" }],
		};

		const text = formatFetchResponse(response);
		expect(text).toContain("# TinyFish Fetch");
		expect(text).toContain("Successful: 1");
		expect(text).toContain("# Example Domain");
		expect(text).toContain("https://bad.invalid: fetch_error");
	});

	test("truncateToolText reports truncation metadata", () => {
		const longText = Array.from(
			{ length: 100 },
			(_, index) => `line ${index}`,
		).join("\n");
		const result = truncateToolText(longText, 120);
		expect(result.details.truncated).toBe(true);
		expect(result.text).toContain("Output truncated");
	});
});
