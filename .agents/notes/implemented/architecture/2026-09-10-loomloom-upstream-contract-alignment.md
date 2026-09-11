# Agent Note: Loomloom upstream contract alignment for dsh-plugin-loomloom

Status: implemented

中文 | [English](2026-09-10-loomloom-upstream-contract-alignment.md)

## Problem

`dsh-plugin-loomloom` talks to the Loomloom product API (`https://loomloom.shengsuanyun.com/loom/v1`) with hand-written `fetch` code in [`src/loom-api.ts`](../../../../dsh-plugin-loomloom/src/loom-api.ts) and hand-written response parsing in [`src/skillbots.ts`](../../../../dsh-plugin-loomloom/src/skillbots.ts). The parsers tolerate multiple candidate field names (`pickText(value, ['id', 'listingId', 'marketListingId'])`) because the JSON contract was inferred by observation rather than taken from an authoritative source.

Two concrete failures follow from that inference-only approach:

1. **Artifact bodies were dropped.** The result payload carries the SkillBot output inline under `inlineText`, but `artifacts()` only read `id`/`label`/`mimeType`/`accessUrl`. `loomloom_get_run_results` therefore returned only a count ("4 output artifact(s) available") and never the result text, forcing an out-of-band trip to the raw API to recover the content. This was fixed in this session by adding `inlineText` to `artifacts()` and the tool render.
2. **Monetary `*T` fields are unhandled.** The upstream returns every amount twice: a converted `moneyResponse` (`taskFixedFee: { amount: "0.2000000", currency: "CNY" }`) and a raw-unit integer (`taskFixedFeeT: 2000000`), where `10,000,000` raw units equal one currency unit. Our `fixedFee()` and `parseQuote()` read only the converted form. If any endpoint ever returns only the `*T` form, we would misread `2000000` as `0.2`-worth-`2000000` or drop the amount entirely.

The upstream publishes a Go CLI ([`cogfoundry-labs/loomloom`](https://github.com/cogfoundry-labs/loomloom)) whose structs under `src/cli/internal/cmd/` are the de-facto JSON schema for the same HTTP API. They are the authoritative contract we have been re-deriving by hand.

## Decision

Keep the direct-HTTP architecture — `dsh-plugin-loomloom` stays a `fetch` client, and we do **not** shell out to the Go CLI binary or port its Go sources to TypeScript. The npm package `@cogfoundry/loomloom` is only an installer wrapper (`bin: { loomloom: 'bin/loomloom.cjs' }`, no `main`/`exports`, no dependencies), so there is no reusable SDK to depend on; embedding a subprocess per tool call adds binary distribution, version, platform, and process-lifecycle cost for no extra capability.

Instead, we treat the CLI's Go structs as the **single authoritative field contract** and align `skillbots.ts` parsing to it, then record the mapping so future upstream changes touch one documented place.

### Monetary units

The upstream unit system (from the CLI `docs/reference/cli.md`):

> 10,000,000 API units = 1 currency unit

Raw-unit fields are named `*T` (e.g. `taskFixedFeeT`, `estimatedBuyerPayableT`). Their converted companions are `moneyResponse` objects (`{ amount, currency }`). The CLI resolves a displayed amount as: prefer the converted `moneyResponse.amount`; otherwise convert the `*T` integer by dividing by `10_000_000`; never guess the currency when only a `*T` value is present.

We add one helper that mirrors `formatResponseMoney`:

```ts
const RAW_UNITS_PER_CURRENCY = 10_000_000

function money(value: Record<string, unknown>, moneyKey: string, rawKey: string, currency: string): { amount: string, currency?: string } | undefined {
  const converted = monetaryText(value[moneyKey])
  if (converted !== undefined) return { ...converted, ...(converted.currency === undefined && currency !== '' ? { currency } : {}) }
  const raw = value[rawKey]
  const units = typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
      ? Number(raw)
      : undefined
  if (units === undefined) return undefined
  return { amount: String(units / RAW_UNITS_PER_CURRENCY), ...(currency === '' ? {} : { currency }) }
}
```

Then:

- `fixedFee()` prefers `taskFixedFee.amount`, falls back to `taskFixedFeeT / 1e7`.
- `parseQuote()` prefers `estimatedBuyerPayable` / `buyerPayable`, falls back to `estimatedBuyerPayableT / 1e7`; the fixed-fee line prefers `taskFixedFee`, falls back to `taskFixedFeeT / 1e7`.

### Authoritative field contract

The tables below are the mapping from upstream (Go struct field `json:` tag, from `src/cli/internal/cmd/{market,run,artifact,helpers}.go`) to our parser. Where our current code already matches, the cell says "aligned"; where it differs, the change is noted. Candidate-name tolerance (`pickText` with multiple keys) is retained only where the upstream itself tolerates multiple shapes (notably `rows`/`items`), otherwise it is collapsed to the single official name to stop masking drift.

#### Listing (list + detail): `marketListingPublicResponse`

| Upstream JSON key | Go type | Our parser today | Action |
|---|---|---|---|
| `id` | `string` | `id`/`listingId`/`marketListingId` | align to `id` |
| `displayName` | `string` | `displayName`/`name` | align to `displayName` |
| `description` | `string` | `description` | aligned |
| `executionAvailabilityStatus` | `string` | same, `=== 'available'` | aligned |
| `listingVersionId` | `string` | many candidates | align to `listingVersionId` |
| `taskFixedFee` | `*moneyResponse` | `taskFixedFee.amount` | add `*T` fallback |
| `taskFixedFeeT` | `*flexInt64` | not read | add fallback source |
| `currency` | `string` | not read for fee | use as fallback currency |
| `inputSchemaSnapshot` | `json.RawMessage` | parsed | aligned |

#### Listing detail extra: input fields (`inputSchemaSnapshot.fields[]`)

The upstream CLI reads the snapshot via `publicinput` and exposes each field's `key`, `label`, `required`, and value type. Our `parseFields()` already covers `key/name/fieldKey`, `label/title/displayName`, `required/isRequired`, `value_type/valueType/type`, `enum_values/enumValues`, and `description/desc/inputHint/help`. Keep the multi-candidate keys here because the snapshot shape is the user-authored TemplateSpec, not a single upstream struct.

#### Run submit (`POST /marketListings/{id}:execute`): `runSubmitResponse`

| Upstream JSON key | Go type | Our parser today | Action |
|---|---|---|---|
| `runId` | `string` | `runId`/`id` via `extractRun` | align to `runId` |
| `status` | `string` | `status` | aligned |
| `acceptedAt` / `acceptedAtUnix` / `accepted_at_unix` | `flexInt64` | not read | no action (not surfaced) |

#### Run detail (`GET /users/me/runs/{id}`): `runDetailResponse`

| Upstream JSON key | Go type | Our parser today | Action |
|---|---|---|---|
| `runId` | `string` | `runId`/`id` | align to `runId` |
| `status` | `string` | `status` | aligned |
| `displayName` (we surface it) | — | `displayName`/`name` | retain tolerance |

#### Result rows (`GET /users/me/runs/{id}/resultRows`): `listRunResultRowsResponse`

The upstream `UnmarshalJSON` accepts both `rows` and `items`. Our `resultItems()` reads `items`/`resultRows`/`rows`. Align to `items`/`rows` (drop `resultRows`, which the upstream does not emit).

| Upstream JSON key | Go type | Our parser today | Action |
|---|---|---|---|
| `rowIndex` | `int` | not read | no action |
| `status` | `string` | read for counts | aligned |
| `errorMessage` / `error` | `string` | not read | no action (input rows must not be exposed) |
| `inputJson` | `string` | not read | deliberately not surfaced |
| `artifacts[]` | `[]runResultRowArtifact` | via `artifacts()` | see below |

#### Artifacts (`GET /users/me/runs/{id}/artifacts`): `listRunArtifactsResponse`

| Upstream JSON key | Go type | Our parser today | Action |
|---|---|---|---|
| `artifactId` | `string` | `artifactId`/`id` | align to `artifactId` |
| `taskId` | `string` | not read | no action |
| `stepId` | `string` | label fallback | aligned |
| `portName` | `string` | label fallback | aligned |
| `mimeType` | `string` | `mimeType` | aligned |
| `accessUrl` | `string` | `accessUrl` (https-checked) | aligned |
| `inlineText` | `string` | **added this session** | aligned (fixed) |

#### Quote (`POST /marketListings/{id}:quote`)

The CLI renders `estimatedBuyerPayable`/`estimatedBuyerPayableT`, `taskFixedFee`/`taskFixedFeeT`, and `currency`. Our `parseQuote()` reads `estimatedBuyerPayable`/`buyerPayable`/`estimatedPayable` and `taskFixedFee`. Align to `estimatedBuyerPayable` (+ `*T` fallback) and `taskFixedFee` (+ `*T` fallback); retain `buyerPayable` tolerance only if the upstream emits it.

## API surface coverage

The buy-side SkillBot loop (`list → show → quote → run → result`) was the first slice. The remaining product surface is now integrated too, split by payload shape: JSON endpoints become model-visible DSH tools, binary/file endpoints become host routes the client drives.

### Model-visible DSH tools (13 total)

| Tool | Upstream endpoint | Notes |
|---|---|---|
| `loomloom_get_balance` | `GET /users/me/balance` | Prefers `availableBalance`, falls back to `availableBalanceT / 1e7` |
| `loomloom_list_my_listings` | `GET /creators/me/marketListings` | Creator-owned listings with sale and review state |
| `loomloom_list_creator_transactions` | `GET /creators/me/marketTransactions` | Both `taskFixedFee` and `finalBuyerPayable` use the `*T` fallback |
| `loomloom_publish_listing` | `POST /marketListings` | Converts the decimal fee to `taskFixedFeeT`; a write that starts a review |
| `loomloom_list_official_templates` | `GET /officialTemplates` | Tolerates `templates`/`items` wrappers, matching the CLI's `UnmarshalJSON` |
| `loomloom_get_template_schema` | `GET /officialTemplates/{id}/schema` | Exposes every declared field with `inputHint`, `enumValues` and `examples` |
| `loomloom_list_my_templates` | `GET /users/me/templates` | Supplies the `templateId` + `latestVersionId` pair that publishing requires |

`publish_listing` is the only new write. The fee is converted with the shared `RAW_UNITS_PER_CURRENCY` ratio so both directions use one constant. `list_my_templates` exists specifically because publishing needs a private template id and version id that no other tool can supply.

#### `loomloom_list_skillbots` pagination profile

The upstream caps `pageSize` at 100 and the market holds ~225 listings, so a full walk takes three pages. The third page is slow server-side (measured 23–66s, occasionally timing out), which made every no-argument `list_skillbots` call stall for tens of seconds. The tool now distinguishes browsing from searching:

- **No `keyword`:** only the first page (`pageSize=100`, ~1.5s) is fetched and returned. Browsing never pays for the slow tail page.
- **With `keyword`:** the bounded walk continues until the full dataset is collected, then matching runs locally against it. This preserves the original "search is matched against the full dataset" contract at the cost of the slow third page, which is a server-side pagination issue (`offset=200`) outside the client's control.

The walk is still guarded by `MAX_MARKET_PAGES` / `MAX_MARKET_LISTINGS` so a pathological upstream cannot loop forever or exceed a bound.

### Host routes (client/file flows)

| Route | Upstream endpoint | Notes |
|---|---|---|
| `GET /api/loomloom/balance` | `GET /users/me/balance` | Pass-through snapshot |
| `GET /api/loomloom/creator/listings` | `GET /creators/me/marketListings` | |
| `GET /api/loomloom/creator/transactions` | `GET /creators/me/marketTransactions` | |
| `GET /api/loomloom/creator/earnings` | `GET /creators/me/earnings` | `pageSize` bounded to digits before forwarding |
| `GET /api/loomloom/templates` | `GET /officialTemplates` | |
| `GET /api/loomloom/templates/schema` | `GET /officialTemplates/{id}/schema` | |
| `GET /api/loomloom/my-templates` | `GET /users/me/templates` | |
| `GET /api/loomloom/market/workbook` | `GET /marketListings/{id}/workbook` | Binary; streamed back with an attachment filename |
| `GET /api/loomloom/templates/workbook` | `GET /officialTemplates/{id}/workbook` | Binary; streamed back with an attachment filename |
| `POST /api/loomloom/orchestration-input` | `POST /orchestrationInputs:upload` | Re-encodes text content as base64 for the upstream `[]byte` field |
| `POST /api/loomloom/market/workbook/validate` | `POST /marketListings/{id}:validateWorkbook` | No charge |
| `POST /api/loomloom/market/workbook/quote` | `POST /marketListings/{id}:quoteWorkbook` | No charge |
| `POST /api/loomloom/market/workbook/run` | `POST /marketListings/{id}:executeWorkbook` | Paid; always sends `confirm: true` plus a `clientRequestId` |
| `POST /api/loomloom/templates/workbook/validate` | `POST /officialTemplates/{id}:validateWorkbook` | No charge |
| `POST /api/loomloom/templates/workbook/precheck` | `POST /officialTemplates/{id}:precheckWorkbook` | Cost estimate; never sends `confirm` |

Workbooks do not cross the tool boundary because a DSH tool result is text; a filled `.xlsx` is bytes a model cannot author. The binary stays in the host route layer where the client already holds the file, and `LoomApi.requestBinary` carries it as base64 across the single upstream hop.

`content` on the workbook routes is base64 bytes, matching the Go CLI's `[]byte` JSON encoding exactly, so the same upstream contract serves both clients.

## Files

- [`dsh-plugin-loomloom/src/skillbots.ts`](../../../../dsh-plugin-loomloom/src/skillbots.ts) — parsing: `money()`/`RAW_UNITS_PER_CURRENCY`, candidate names collapsed to official keys, `inlineText`, plus `getBalance`, `listMyListings`, `listCreatorTransactions`, `publishListing`, `listOfficialTemplates`, `getTemplateSchema`, `listMyTemplates`, `downloadMarketWorkbook`, `downloadTemplateWorkbook`, `uploadOrchestrationInput`.
- [`dsh-plugin-loomloom/src/loom-api.ts`](../../../../dsh-plugin-loomloom/src/loom-api.ts) — `requestBinary` for workbook downloads plus `suggestedFilename`, which strips path separators from the upstream `Content-Disposition`.
- [`dsh-plugin-loomloom/src/tools.ts`](../../../../dsh-plugin-loomloom/src/tools.ts) — 13 tools; both result tools render `inlineText`.
- [`dsh-plugin-loomloom/src/routes.ts`](../../../../dsh-plugin-loomloom/src/routes.ts) — creator/template/workbook host routes; `forwardWorkbookTo` is shared by the Market and official-template workbook actions.
- [`dsh-plugin-loomloom/tests/skillbots.spec.ts`](../../../../dsh-plugin-loomloom/tests/skillbots.spec.ts) — `*T`-only and `*T`+`money` monetary cases.
- [`dsh-plugin-loomloom/tests/tools.spec.ts`](../../../../dsh-plugin-loomloom/tests/tools.spec.ts) — tool roster, `inlineText` rendering, balance/creator/template tools, `taskFixedFeeT` conversion on publish.
- [`dsh-plugin-loomloom/tests/routes.spec.ts`](../../../../dsh-plugin-loomloom/tests/routes.spec.ts) — route forwarding, id rejection, binary streaming, base64 upload, workbook-run confirmation, template precheck without `confirm`.
- [`dsh-plugin-loomloom/tests/loom-api.spec.ts`](../../../../dsh-plugin-loomloom/tests/loom-api.spec.ts) — `requestBinary` decoding, filename sanitization, failure status.

## Verification

- `corepack yarn test` in `dsh-plugin-loomloom` (or `node --import tsx --test tests/**/*.spec.ts`) passes, including the monetary fallback, `inlineText`, creator/template tool and workbook route cases.
- `corepack yarn typecheck` passes for both `tsconfig.json` and `tsconfig.client.json`.
- Manual check: a completed run's `loomloom_get_run_results` render contains each artifact body, not only a count.
- Live shape probe against `loomloom.shengsuanyun.com` confirmed the read endpoints this note documents: `/users/me/balance` returns `availableBalance` plus `availableBalanceT`, `/officialTemplates` wraps its rows in `items`, `/users/me/templates` returns `items` with `latestVersionId`/`publishedVersionId`, and `/creators/me/marketListings` returns `items`.
- Not yet verified against the live upstream: the write paths (`publishListing`, both workbook actions and `orchestrationInputs:upload`) have only been exercised against fixtures, because no creator publish or filled workbook was performed in this session. Treat the first live call as the confirmation.

## Alternatives considered

**Shell out to the official Go CLI (`npx @cogfoundry/loomloom market list --output json`).** Adds binary installation per platform, version pinning, subprocess lifecycle, timeout and signal handling, and a `child_process` hop per tool call — for the same HTTP surface we already reach. Rejected.

**Port the Go structs into a generated TypeScript schema.** A one-time codegen gives typed parsing but adds a build step and a second source of truth that can drift from the Go CLI. The hand-written parser is small enough that a documented mapping table is cheaper and easier to review. Rejected for now; reconsider if the endpoint count grows.

**Depend on `@cogfoundry/loomloom` from npm.** The published package has no `main`/`exports` and no API surface — it only installs the CLI binary. There is nothing to import. Rejected as infeasible.

**Keep inference-only parsing.** This is the status quo that already caused the dropped `inlineText` bug and the unhandled `*T` unit system. Rejected.

**Expose the workbook flows as DSH tools instead of host routes.** A tool result is text, so a `loomloom_get_workbook` tool would have to inline base64 bytes a model cannot turn back into a spreadsheet, and a `loomloom_run_workbook` tool would need the model to author those bytes. The client already holds the file, so the binary stays in the route layer and only the JSON results come back. Rejected.

## Consequences

- Field-name drift becomes visible: the mapping table is the single place that records "official key ↔ our parser", and the parser collapses to official names where the upstream has exactly one shape.
- Monetary amounts are correct even when an endpoint returns only raw `*T` units, because the `1e7` conversion is centralized in one helper.
- No new runtime dependency or subprocess boundary is introduced; the plugin stays a self-contained `fetch` client.
