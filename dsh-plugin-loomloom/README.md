# Loomloom DSH Plugin

This package is the DSH Host integration replacing the legacy Loomloom Go sidecar and Tauri shell. DSH Desktop remains responsible for the Electron window, profile lifecycle, local Web carrier, and plugin loading; this plugin owns only the Loomloom/胜算云 API boundary.

## Current MVP

- Uses an HTTPS-only Loomloom API origin (default: `https://loomloom.shengsuanyun.com/loom/v1`).
- Resolves the common ShengSuanYun platform key through DSH `credentials` for every upstream request. The default reference is `SHENGSUANYUN_API_KEY`, matching the DSH Models UI provider id `shengsuanyun`; no token is returned to a Client or logged.
- Preconfigures the `shengsuanyun` `llm-pi-ai` route in DSH Desktop. Every successful Loomloom login saves `deepseek-v4-flash` through DSH's `agentDefaultModel` service, so newly created chats use the same credential without reading a local provider-key field.
- Registers six DSH-native chat tools for discovery, schema inspection, quote-backed preparation, approval-gated execution, run status, and safe result retrieval.
- **The Market surface never executes anything.** Clicking a SkillBot — or submitting its preview form — performs a ShengSuanYun credential check and then puts **one user message** into a **new conversation in the same workspace group**; the agent drives the tools from there. That keeps a single path to a paid run, a single place its result is reported, and a run that owns its own transcript instead of being appended to whatever thread the user was reading. (`resolveSendTarget` accepts `target: 'current-session'` for callers that genuinely want to continue a thread.) Sending only happens once the credential is present: an unconfigured account gets the sign-in surface first, and the deferred call resumes automatically the moment authorization completes.
- Each storefront row carries a **preview** control that opens the SkillBot's published input form (widgets, hints, defaults, enums, ordering, file inputs). Values filled there travel with the message as a JSON block; a bare row click sends the prompt with an explicit "nothing filled in yet" sentence so the agent never has to guess. Preview itself needs no request: the storefront payload already carries the parsed schema.
- After an approved execution, polls the returned run with bounded exponential backoff and returns terminal row counts/artifact links to the same DSH chat; cancellation or timeout returns a non-terminal pending result without retrying the paid execute call.
- **Renders run output as structure, not as raw JSON.** Artifact payloads are drawn on the tool card as Markdown tables — the conversation renderer supports GFM tables — with dotted paths for a single object, shape hints for nested containers, and row/column/cell caps that report what they elided. Non-JSON payloads stay fenced; a payload is bounded before it reaches either the model or the card.
- Every Market execution receives a server quote first, is bound to the active DSH Agent through a short-lived draft, and only proceeds after DSH grants one approval.
- Registers a browser-first, loopback PKCE authorization flow plus an API Token fallback. The exchanged credential is verified against the configured Loom API before it is saved into the DSH-owned credential record.
- Publishes a **storefront**: the Market presents one creator's own SkillBots. In the default *creator mode* the id set is derived on every refresh from `GET /creators/me/marketListings`, so a newly published SkillBot appears with no maintenance; the credential is used **only** for that discovery, and every listing detail is still read anonymously. Browsing therefore never requires the *user* to sign in, and the full public market list (224 listings, ~480 KB) is never requested. The resolved storefront is cached for 10 minutes in the standard settings service and survives a restart; a failed refresh serves the last good snapshot marked `stale`.
- Exposes local same-origin routes for health, credential presence, storefront, market discovery/detail, input-asset upload, and run listing/status.
- Includes a DSH Settings tab for credential presence, Market SkillBot browsing, and public input-schema inspection. It deliberately contains no execution control.

> **Why a creator credential, not the public list.** The public market *list* route returns no creator identifier at all — across all 224 published listings every `creator` is `{ nickname: "" }` — so a single-creator storefront cannot be derived from it. The only route that publishes a stable creator↔listing relationship (plus sale status) is `GET /creators/me/marketListings`, which requires that creator's credential. Per-listing details are then read for `version` and `updatedAt`, which the list route does not carry.

## Profile configuration

Install this package into the selected DSH profile using `dsh plugin add dsh-plugin-loomloom`; its `cordis.patch.yml` inserts the Host row. Configure that row according to the DSH plugin CLI/profile workflow:

```yaml
- id: loomloom
  name: dsh-plugin-loomloom
  config:
    # Optional; defaults to the production Loomloom API.
    baseUrl: https://loomloom.shengsuanyun.com/loom/v1
    # DSH resolves this from its credential provider (including the process env).
    tokenRef: SHENGSUANYUN_API_KEY
    # Creator mode: name the environment variable holding the creator credential
    # whose catalogue becomes the market. Read from the process environment at
    # startup, so export it where the app is launched.
    creatorKeyEnv: LOOMLOOM_CREATOR_KEY
```

```bash
LOOMLOOM_CREATOR_KEY=<creator key> corepack yarn dev
```

Only `status: published` **and** `saleStatus: listed` entries are taken. The public detail route answers `404` for anything unlisted, so a draft or withdrawn SkillBot could only ever render as "no longer listed" — advertising it would be dishonest. A derived storefront is ordered newest first, since it has no authoring order.

If `creatorKeyEnv` is configured but the variable is unset, the storefront stays **empty** and reports a missing creator credential (and the Host logs a warning). It deliberately does *not* fall back to a pinned list: a silent fallback would make a misconfigured deployment look healthy while quietly no longer tracking new publications.

### Alternative: a pinned allow-list

Set `storefrontListingIds` instead of `creatorKeyEnv` to pin a fixed set, in authoring order. `LOOMLOOM_STOREFRONT_IDS` (comma-separated) overrides it when set, following the same shape as the credential knobs (`apiKeyEnv` / `tokenRef`): the environment names the value, the config carries the default. An unset or all-blank variable is ignored rather than read as "no storefront" — clearing a shipped build's storefront should take an explicit empty config, not a stray empty variable. `LOOMLOOM_STOREFRONT_IDS` has no effect in creator mode.

A malformed id or variable name fails `resolveLoomConfig` at composition time rather than at first render. Pinning an id the Market no longer lists resolves to `404` and is reported as unavailable instead of failing the storefront.

The currently exposed routes are all same-origin and loopback-only through the DSH Web carrier:

- `GET /api/loomloom/health`
- `GET /api/loomloom/credentials`
- `GET /api/loomloom/storefront?refresh=1`
- `GET /api/loomloom/market`
- `GET /api/loomloom/market/skillbot?listingId=…`
- `POST /api/loomloom/inputAssets`
- `GET /api/loomloom/runs`
- `GET /api/loomloom/runs/status?runId=…`

The Host also keeps the hardened `POST /api/loomloom/market/skillbot/{quote,execute}` pair (short-lived `confirmationToken` bound to the listing and the input fingerprint, single-use `clientRequestId`), shared with the workbook flows above. The storefront page does **not** drive them: for the page's flow, quoting and execution belong to the agent's tools, which are gated by DSH's paid-execution approval. That keeps one path from this page to a spend instead of two.

There is deliberately **no client-side result route**. Artifact downloads do not need one: the upstream `accessUrl` is published by `loomloom_get_run_results` directly.

The loopback callback uses a fresh PKCE verifier and state for each attempt, accepts exactly one callback, and never places a credential in a URL or Client response.

## Safe Market smoke verification

The automated tool-chain smoke test uses a mocked Loom API and explicitly rejects the final approval. It verifies the same chat sequence used in production—discovery, schema read, quote-backed draft, rejected approval, run-status read, and result/artifact read—without sending `:execute` or creating a billable Market run:

```bash
corepack yarn workspace dsh-plugin-loomloom test --test-name-pattern='complete no-charge chat smoke path'
```

For a live account, use the Settings page to confirm that the credential is configured, then use only `loomloom_list_skillbots` and `loomloom_get_skillbot` in DSH chat. A live quote is non-executing, but it may be business-visible; do not call `loomloom_execute_skillbot` unless the displayed server quote is correct and the DSH approval prompt is explicitly accepted. The remaining live acceptance gap is a disposable Market listing/run that can be exercised without creating a charge; production listings must never be used as a smoke target.

## Tool surface

DSH exposes thirteen `loomloom_*` tools. Ten are read-only:

| Tool | Endpoint |
| --- | --- |
| `loomloom_list_skillbots` | `GET /marketListings` (full dataset, keyword matched locally) |
| `loomloom_get_skillbot` | `GET /marketListings/{id}` |
| `loomloom_get_run` | `GET /users/me/runs/{id}` |
| `loomloom_get_run_results` | `GET /users/me/runs/{id}/resultRows` + `/artifacts` |
| `loomloom_get_balance` | `GET /users/me/balance` |
| `loomloom_list_my_listings` | `GET /creators/me/marketListings` |
| `loomloom_list_creator_transactions` | `GET /creators/me/marketTransactions` |
| `loomloom_list_official_templates` | `GET /officialTemplates` |
| `loomloom_get_template_schema` | `GET /officialTemplates/{id}/schema` |
| `loomloom_list_my_templates` | `GET /users/me/templates` |

Three tools change state and are gated by the DSH approval prompt:

- `loomloom_prepare_execution` — creates a quote and a short-lived draft; no charge and no upstream write.
- `loomloom_execute_skillbot` — runs a prepared draft and **incurs the quoted fee**.
- `loomloom_publish_listing` — publishes a template version to the Market and **starts a review**; ask the user for the display name, template ids and fixed fee before calling it.

Workbook (`.xlsx`) flows are not tools. A tool result is text, so a workbook cannot cross that boundary; the client drives them through host routes instead: `GET /api/loomloom/market/workbook` and `GET /api/loomloom/templates/workbook` download a template, and `POST /api/loomloom/market/workbook/{validate,quote,run}` and `POST /api/loomloom/templates/workbook/{validate,precheck}` submit a filled one. Only the Market `run` route is billable, and it always sends `confirm: true` with an idempotency key.

## Installing a SkillBot as a local agent skill

A Market listing can ship a backend-published Agent Skill package: a ZIP holding a
complete skill (`SKILL.md` plus references and scripts). Installing one makes the skill
available to a local agent instead of calling the SkillBot over the network.

Five host routes expose it, and none of them is a model-visible tool because the payload
is a ZIP and a filesystem path:

| Route | Behaviour |
| --- | --- |
| `GET /api/loomloom/skill-package?listingId=` | Package head: `available`, `archiveHash`, `mode`, `sizeBytes` |
| `GET /api/loomloom/skill-package/archive?listingId=` | Download the ZIP, verified against the published hash |
| `POST /api/loomloom/skill-package/install?listingId=` | Verify, unpack and install into the skill root |
| `POST /api/loomloom/skill-package/uninstall` | Remove an installed skill (body: `{ skillName }`) |
| `GET /api/loomloom/skill-package/installed` | List installed packages from their markers |

Install semantics:

- Packages land in `<DSH_HOME>/skills` (falling back to `~/.loomloom/skills`). The path
  comes from the host environment, never from the request, so a client cannot choose a
  write target.
- The downloaded ZIP must match the published `sha256:<hex>` before anything is written.
- The archive is staged inside the skill root and renamed into place, so a crash leaves
  either the previous version or nothing, never a half-written skill.
- Each install writes a `.loomloom-skill.json` marker (`schemaVersion`, `source`,
  `archiveHash`). A repeat install of the same source and hash reports `unchanged` and
  does not re-download.
- Uninstall only removes directories carrying a valid marker, so an unrelated folder in
  the skill root is never deleted.

Verify the whole path against a live account (nothing is written outside a temporary
directory):

```bash
yarn workspace dsh-plugin-loomloom verify:skill
# or: node --import tsx scripts/verify-skill-install.ts --listing <listing-id>
```
