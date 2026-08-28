# pi-tinyfish

Pi package that adds TinyFish Search and Fetch tools using `@tiny-fish/sdk`.

## Tools

- `tinyfish_search` — web search with ranked titles, snippets, and URLs.
- `tinyfish_fetch` — render/fetch up to 10 URLs and return extracted content as `markdown`, `html`, or `json`.

Save the API key from Pi:

```text
/tinyfish
```

The command stores it in `~/.pi/agent/tinyfish.json` with owner-only permissions. Alternatively, use the standard environment variable:

```bash
export TINYFISH_API_KEY="your_api_key_here"
```

## Install

### npm

```bash
pi install npm:pi-tinyfish
```

### git

```bash
pi install git:github.com/x1any/pi-tinyfish
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run check
```

## Notes

- TinyFish Search latency is typically 1–3s; the tool defaults to a 10s timeout.
- TinyFish Fetch can take longer; the tool defaults to a 150s timeout as recommended by TinyFish docs.
- Tool output is truncated to Pi's default 50KB limit unless `maxBytes` is set.
