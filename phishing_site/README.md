# geo-page Worker

A Cloudflare Worker that serves different content based on visitor location and device type.

## Routes

### `/geo`

Displays the visitor's country flag emoji and country name, determined via `request.cf.country`.

### `/cloak`

Displays a cat emoji for desktop/tablet users. On mobile devices (detected via the `CF-Device-Type` header), it displays a devil imp emoji instead.

### All other paths

Returns a 404 response.

## Commands

Install wrangler (if not already available):

```bash
npm install -g wrangler
```

Authenticate with Cloudflare:

```bash
npx wrangler login
```

Or set an API token:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
```

Preview locally:

```bash
npx wrangler dev
```

Deploy to production:

```bash
npx wrangler deploy
```

View live logs:

```bash
npx wrangler tail
```

Delete the worker:

```bash
npx wrangler delete
```
