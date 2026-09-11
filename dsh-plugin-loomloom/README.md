# Loomloom DSH Plugin

This package is the DSH Host integration replacing the legacy Loomloom Go sidecar and Tauri shell. DSH Desktop remains responsible for the Electron window, profile lifecycle, local Web carrier, and plugin loading; this plugin owns only the Loomloom/胜算云 API boundary.

## Current MVP

- Uses an HTTPS-only Loomloom API origin (default: `https://loomloom.shengsuanyun.com/loom/v1`).
- Resolves the common ShengSuanYun platform key through DSH `credentials` for every upstream request. The default reference is `SHENGSUANYUN_API_KEY`, matching the DSH Models UI provider id `shengsuanyun`; no token is returned to a Client or logged.
- Preconfigures the `shengsuanyun` `llm-pi-ai` route in DSH Desktop. Every successful Loomloom login saves `deepseek/deepseek-v4-flash` through DSH's `agentDefaultModel` service, so newly created chats use the same credential without reading a local provider-key field.
- Registers six DSH-native chat tools for discovery, schema inspection, quote-backed preparation, approval-gated execution, run status, and safe result retrieval.
- After an approved execution, polls the returned run with bounded exponential backoff and returns terminal row counts/artifact links to the same DSH chat; cancellation or timeout returns a non-terminal pending result without retrying the paid execute call.
- Every Market execution receives a server quote first, is bound to the active DSH Agent through a short-lived draft, and only proceeds after DSH grants one approval.
- Registers a browser-first, loopback PKCE authorization flow plus an API Token fallback. The exchanged credential is verified against the configured Loom API before it is saved into the DSH-owned credential record.
- Exposes local same-origin routes for health, credential presence, market discovery/detail, and run listing/status. A browser execution endpoint is intentionally absent because the page must not bypass DSH approval.
- Includes a DSH Settings tab for credential presence, Market SkillBot browsing, and public input-schema inspection. It deliberately contains no execution control.

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
```

The currently exposed routes are all same-origin and loopback-only through the DSH Web carrier:

- `GET /api/loomloom/health`
- `GET /api/loomloom/credentials`
- `GET /api/loomloom/market`
- `GET /api/loomloom/market/skillbot?listingId=…`
- `GET /api/loomloom/runs`
- `GET /api/loomloom/runs/status?runId=…`

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

