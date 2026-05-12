import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
	FetchGetContentsParams,
	FetchResponse,
	SearchQueryParams,
	SearchQueryResponse,
} from "@tiny-fish/sdk";
import { TinyFish } from "@tiny-fish/sdk";

const SEARCH_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 150_000;
const MAX_TOOL_BYTES = 200_000;
const MAX_FETCH_URLS = 10;
const LINK_PREVIEW_LIMIT = 50;

const TinyFishSearchParams = Type.Object({
	query: Type.String({
		minLength: 1,
		description:
			"Search query string. Supports search operators like site: and -site:.",
	}),
	location: Type.Optional(
		Type.String({
			description: "Country code for localized results, e.g. US, GB, FR.",
		}),
	),
	language: Type.Optional(
		Type.String({ description: "Language code for results, e.g. en, fr, de." }),
	),
	page: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 10,
			description: "Search result page number, starting at 0 (max 10).",
		}),
	),
	maxBytes: Type.Optional(
		Type.Number({
			minimum: 1000,
			maximum: MAX_TOOL_BYTES,
			description:
				"Maximum bytes to return to the model (default 50KB, max 200KB).",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			minimum: 1000,
			maximum: 120_000,
			description: "Client timeout in milliseconds (default 10000).",
		}),
	),
});

type TinyFishSearchInput = Static<typeof TinyFishSearchParams>;

const TinyFishFetchParams = Type.Object({
	url: Type.Optional(Type.String({ description: "Single URL to fetch." })),
	urls: Type.Optional(
		Type.Array(Type.String(), {
			minItems: 1,
			maxItems: MAX_FETCH_URLS,
			description: "URLs to fetch. TinyFish accepts up to 10 URLs per request.",
		}),
	),
	format: Type.Optional(
		StringEnum(["markdown", "html", "json"] as const, {
			description: "Output format for extracted content (default markdown).",
		}),
	),
	links: Type.Optional(
		Type.Boolean({ description: "Include page hyperlinks in each result." }),
	),
	image_links: Type.Optional(
		Type.Boolean({ description: "Include image URLs in each result." }),
	),
	maxBytes: Type.Optional(
		Type.Number({
			minimum: 1000,
			maximum: MAX_TOOL_BYTES,
			description:
				"Maximum bytes to return to the model (default 50KB, max 200KB).",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			minimum: 1000,
			maximum: 180_000,
			description: "Client timeout in milliseconds (default 150000).",
		}),
	),
});

type TinyFishFetchInput = Static<typeof TinyFishFetchParams>;
type FetchFormat = NonNullable<FetchGetContentsParams["format"]>;

type TruncationDetails = {
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
};

function textResult(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function optionalTrim(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeUrls(params: {
	url?: unknown;
	urls?: unknown;
}): string[] {
	const raw = [
		...(typeof params.url === "string" ? [params.url] : []),
		...(Array.isArray(params.urls) ? params.urls : []),
	];
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const url = value.trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
	}
	return urls;
}

function normalizeFetchFormat(value: unknown): FetchFormat | undefined {
	return value === "markdown" || value === "html" || value === "json"
		? value
		: undefined;
}

export function truncateToolText(
	text: string,
	maxBytes = DEFAULT_MAX_BYTES,
): { text: string; details: TruncationDetails } {
	const truncated = truncateHead(text, {
		maxBytes,
		maxLines: DEFAULT_MAX_LINES,
	});
	const details: TruncationDetails = {
		truncated: truncated.truncated,
		truncatedBy: truncated.truncatedBy,
		totalLines: truncated.totalLines,
		totalBytes: truncated.totalBytes,
		outputLines: truncated.outputLines,
		outputBytes: truncated.outputBytes,
	};
	if (!truncated.truncated) return { text: truncated.content, details };

	const notice = `\n\n[Output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}). Use maxBytes to raise the limit, or narrow the request.]`;

	return { text: `${truncated.content}${notice}`, details };
}

export function formatSearchResponse(
	response: SearchQueryResponse,
	options: { location?: string; language?: string } = {},
): string {
	const lines = [
		"# TinyFish Search",
		`Query: ${response.query}`,
		`Page: ${response.page ?? 0}`,
		`Total results: ${response.total_results}`,
	];
	if (options.location) lines.push(`Location: ${options.location}`);
	if (options.language) lines.push(`Language: ${options.language}`);
	lines.push("");

	if (response.results.length === 0) {
		lines.push("No results returned.");
		return lines.join("\n");
	}

	for (const result of response.results) {
		lines.push(`## ${result.position}. ${result.title}`);
		lines.push(`URL: ${result.url}`);
		lines.push(`Site: ${result.site_name}`);
		if (result.snippet) lines.push(`Snippet: ${result.snippet}`);
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

function stringifyFetchText(text: unknown): string {
	if (text === null || text === undefined) return "";
	if (typeof text === "string") return text;
	return JSON.stringify(text, null, 2);
}

function appendLinks(
	lines: string[],
	title: string,
	links: string[] | undefined,
) {
	if (!links || links.length === 0) return;
	lines.push(`${title}: ${links.length}`);
	for (const link of links.slice(0, LINK_PREVIEW_LIMIT)) {
		lines.push(`- ${link}`);
	}
	if (links.length > LINK_PREVIEW_LIMIT) {
		lines.push(`- ... ${links.length - LINK_PREVIEW_LIMIT} more`);
	}
}

export function formatFetchResponse(response: FetchResponse): string {
	const lines = [
		"# TinyFish Fetch",
		`Successful: ${response.results.length}`,
		`Errors: ${response.errors.length}`,
		"",
	];

	for (const [index, page] of response.results.entries()) {
		const title = page.title || page.url;
		const text = stringifyFetchText(page.text);
		lines.push(`## ${index + 1}. ${title}`);
		lines.push(`URL: ${page.url}`);
		if (page.final_url && page.final_url !== page.url) {
			lines.push(`Final URL: ${page.final_url}`);
		}
		if (page.description) lines.push(`Description: ${page.description}`);
		if (page.language) lines.push(`Language: ${page.language}`);
		if (page.author) lines.push(`Author: ${page.author}`);
		if (page.published_date) lines.push(`Published: ${page.published_date}`);
		if (typeof page.latency_ms === "number")
			lines.push(`Latency: ${page.latency_ms}ms`);
		lines.push(`Format: ${page.format}`);
		appendLinks(lines, "Links", page.links);
		appendLinks(lines, "Image links", page.image_links);
		lines.push("", "### Content");
		if (page.format === "html") {
			lines.push("```html", text || "(empty)", "```");
		} else if (page.format === "json") {
			lines.push("```json", text || "null", "```");
		} else {
			lines.push(text || "(empty)");
		}
		lines.push("");
	}

	if (response.errors.length > 0) {
		lines.push("## Errors");
		for (const item of response.errors) {
			lines.push(`- ${item.url}: ${item.error}`);
		}
	}

	return lines.join("\n").trimEnd();
}

function searchRequest(
	params: TinyFishSearchInput,
): SearchQueryParams | string {
	const query = params.query.trim();
	if (!query) return "No query provided.";

	const request: SearchQueryParams = { query };
	const location = optionalTrim(params.location);
	const language = optionalTrim(params.language);
	if (location) request.location = location;
	if (language) request.language = language;
	if (typeof params.page === "number")
		request.page = normalizeNumber(params.page, 0, 0, 10);
	return request;
}

function fetchRequest(
	params: TinyFishFetchInput,
): FetchGetContentsParams | string {
	const urls = normalizeUrls(params);
	if (urls.length === 0) return "No URL provided.";
	if (urls.length > MAX_FETCH_URLS) {
		return `TinyFish Fetch accepts at most ${MAX_FETCH_URLS} URLs per request.`;
	}

	const request: FetchGetContentsParams = { urls };
	const format = normalizeFetchFormat(params.format);
	if (format) request.format = format;
	if (typeof params.links === "boolean") request.links = params.links;
	if (typeof params.image_links === "boolean")
		request.image_links = params.image_links;
	return request;
}

function tinyfishClient(timeout: number): TinyFish {
	return new TinyFish({ timeout });
}

function renderSimpleCall(
	name: string,
	value: unknown,
	theme: Parameters<
		NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"]>
	>[1],
) {
	const raw = typeof value === "string" ? value : "";
	const display = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw || "(empty)";
	return new Text(
		theme.fg("toolTitle", theme.bold(`${name} `)) + theme.fg("accent", display),
		0,
		0,
	);
}

export default function tinyfishExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "tinyfish_search",
		label: "TinyFish Search",
		description:
			"Search the web using the TinyFish Search API via @tiny-fish/sdk. Requires TINYFISH_API_KEY. Returns ranked titles, snippets, and URLs. Output is truncated to 50KB by default.",
		promptSnippet:
			"Search the web with TinyFish for ranked results, snippets, and URLs. Use location/language for geo-targeting.",
		promptGuidelines: [
			"Use tinyfish_search when the user needs web search results or URLs before fetching full page content.",
			"Use search operators in tinyfish_search query strings, such as site:docs.example.com or -site:youtube.com, when scoping results helps.",
		],
		parameters: TinyFishSearchParams,
		async execute(_toolCallId, params, _signal, onUpdate) {
			const request = searchRequest(params);
			if (typeof request === "string") {
				return textResult(`Error: ${request}`, { error: request });
			}

			const maxBytes = normalizeNumber(
				params.maxBytes,
				DEFAULT_MAX_BYTES,
				1000,
				MAX_TOOL_BYTES,
			);
			const timeoutMs = normalizeNumber(
				params.timeoutMs,
				SEARCH_TIMEOUT_MS,
				1000,
				120_000,
			);
			onUpdate?.({
				content: [
					{ type: "text", text: `Searching TinyFish: ${request.query}` },
				],
				details: { phase: "search", query: request.query },
			});

			try {
				const response = await tinyfishClient(timeoutMs).search.query(request);
				const formatted = formatSearchResponse(response, {
					location: request.location,
					language: request.language,
				});
				const output = truncateToolText(formatted, maxBytes);
				return textResult(output.text, {
					provider: "tinyfish",
					kind: "search",
					query: response.query,
					page: response.page ?? 0,
					totalResults: response.total_results,
					returnedResults: response.results.length,
					truncation: output.details,
					results: response.results,
				});
			} catch (error) {
				const message = errorText(error);
				return textResult(`Error: ${message}`, {
					provider: "tinyfish",
					kind: "search",
					query: request.query,
					error: message,
				});
			}
		},
		renderCall(args, theme) {
			return renderSimpleCall(
				"tinyfish_search",
				(args as { query?: string }).query,
				theme,
			);
		},
	});

	pi.registerTool({
		name: "tinyfish_fetch",
		label: "TinyFish Fetch",
		description:
			"Fetch and extract clean content from up to 10 URLs using the TinyFish Fetch API via @tiny-fish/sdk. Requires TINYFISH_API_KEY. Use markdown by default; html/json are available. Output is truncated to 50KB by default. TinyFish recommends a 150s client timeout for fetch.",
		promptSnippet:
			"Fetch known URLs with TinyFish to get rendered/extracted page content as markdown, html, or json.",
		promptGuidelines: [
			"Use tinyfish_fetch when you already have URLs and need full extracted content; use tinyfish_search first if you need to discover URLs.",
			`tinyfish_fetch accepts at most ${MAX_FETCH_URLS} URLs per call; batch related URLs together when useful.`,
		],
		parameters: TinyFishFetchParams,
		async execute(_toolCallId, params, _signal, onUpdate) {
			const request = fetchRequest(params);
			if (typeof request === "string") {
				return textResult(`Error: ${request}`, { error: request });
			}

			const maxBytes = normalizeNumber(
				params.maxBytes,
				DEFAULT_MAX_BYTES,
				1000,
				MAX_TOOL_BYTES,
			);
			const timeoutMs = normalizeNumber(
				params.timeoutMs,
				FETCH_TIMEOUT_MS,
				1000,
				180_000,
			);
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `Fetching ${request.urls.length} URL(s) with TinyFish...`,
					},
				],
				details: { phase: "fetch", urlCount: request.urls.length },
			});

			try {
				const response =
					await tinyfishClient(timeoutMs).fetch.getContents(request);
				const formatted = formatFetchResponse(response);
				const output = truncateToolText(formatted, maxBytes);
				return textResult(output.text, {
					provider: "tinyfish",
					kind: "fetch",
					urlCount: request.urls.length,
					successful: response.results.length,
					errors: response.errors,
					truncation: output.details,
					results: response.results.map((page) => ({
						url: page.url,
						final_url: page.final_url,
						title: page.title,
						description: page.description,
						language: page.language,
						author: page.author,
						published_date: page.published_date,
						format: page.format,
						textLength: stringifyFetchText(page.text).length,
						linksCount: page.links?.length,
						imageLinksCount: page.image_links?.length,
						latency_ms: page.latency_ms,
					})),
				});
			} catch (error) {
				const message = errorText(error);
				return textResult(`Error: ${message}`, {
					provider: "tinyfish",
					kind: "fetch",
					urls: request.urls,
					error: message,
				});
			}
		},
		renderCall(args, theme) {
			const params = args as { url?: string; urls?: string[] };
			return renderSimpleCall(
				"tinyfish_fetch",
				params.url ?? params.urls?.join(" | "),
				theme,
			);
		},
	});
}
