# dsh-jumpserver

[简体中文](./README.zh-CN.md)

A DeepSeek Harness plugin for querying and managing JumpServer assets through conversation, authenticated with a JumpServer AccessKeyID/AccessKeySecret pair (HTTP Signature).

## Why dsh-jumpserver

- Inspect JumpServer assets, users, accounts, permissions, sessions, command audit logs, user groups, command filters, asset-tree nodes, and RBAC roles/bindings through conversation.
- Manage assets, accounts, users, permissions, user groups, command groups, command filters, asset-tree nodes, and custom RBAC roles/bindings, plus password/MFA/SSH-key resets for users.
- Every write operation triggers a mandatory native user-approval prompt — the model cannot bypass it.
- Secrets, passwords, public keys, MFA secrets, and account passphrases are redacted from read responses before they reach the model.
- Authenticate with JumpServer's native HTTP Signature scheme (`hmac-sha256`); the AccessKeySecret stays in the local DSH credential store.

## Requirements

| Component | Supported baseline |
| --- | --- |
| Node.js | 20.11 or newer |
| DeepSeek Harness | `0.2.0-rc.1` – `0.2.1-rc.2` (and later 0.2.1 prereleases) |
| JumpServer | REST API `v1` (Access Key authentication) |

## Installation (for the agent)

For local development, install from the local path:

```bash
npm ci
dsh plugin --profile add link:/absolute/path/to/dsh-jumpserver
```

Once published, install a released, immutable tag whenever possible:

```bash
dsh plugin --profile add github:we39/dsh-jumpserver#v<version>
```

Install the mutable development branch only for testing:

```bash
dsh plugin --profile add github:we39/dsh-jumpserver
```

Restart the selected DSH profile after installation. On Windows, use an absolute `link:C:/path/to/dsh-jumpserver` path.

## Configuration

In DSH, open **Settings → JumpServer** (a standalone section in the left navigation on DeepSeek Harness 0.2.0+). On 0.1.7 hosts it is the **JumpServer** tab under **Settings → Plugins**; on 0.1.5 and earlier it is a card under **Settings → Plugins**.

The page lists your JumpServer **sources**. Add one per JumpServer you want the assistant to reach (for example production and staging). Each source has:

- **Source name**: required and unique; any language. This is what you (or the assistant) use to pick the source.
- **UID**: generated automatically, globally unique, read-only. Credentials are keyed by it, so renaming a source never loses its keys.
- **JumpServer URL**: the absolute base URL, for example `https://jumpserver.example.com`.
- **Access Key** / **Secret Key**: create the pair from the JumpServer web console under your personal API Key list.

Mark one source as the **default**; tool calls that omit `source` use it. With a single source it is the default automatically.

The Access Key/Secret Key use DSH's privileged loopback credential RPC — write-only, the stored values are never read back or displayed. Names, URLs and the default are stored in the `jumpserver` settings namespace as non-secret fields. Removing a source clears only its own keys, and never a key that another source still references.

The page is shown in Simplified Chinese by default and switches to English only when DSH itself is set to English.

HTTP and HTTPS both work out of the box — internal deployments without TLS certificates can use an `http://` URL with no extra setup. To enforce HTTPS only (all sources), disable it in plugin configuration:

```yaml
allowInsecureHttp: false
```

### Multiple sources

Every tool accepts an optional `source` argument (a source name or UID). Ask the assistant for "the staging JumpServer" and it calls `jumpserver_sources` to discover the names, then passes `source`. If several sources exist and none is the default, omitting `source` is an error rather than a guess.

For write tools the approval prompt names the target source, and the approval is bound to it: if the default changes between approval and execution, the write is refused instead of landing on a different JumpServer.

### Upgrading from 0.11.x

Your existing single-source setup keeps working. On first start the plugin turns it into a source named `default`, **reusing the same stored Access Key / Secret Key** (the keys themselves are not moved or re-entered). If that automatic step could not run, the settings page shows a "Legacy single-source configuration found" notice with an **Import as a source** button.

### JumpServer permissions

Create the AccessKey under a JumpServer account that only has read access to the assets you want visible to the assistant. Avoid using a super-admin account's key for this integration.

## Tools

54 tools (13 read-only / 41 write) across 11 domains. All write tools require native user approval. Every tool except `jumpserver_sources` takes an optional `source` argument.

| Domain | Tools | Scope |
| --- | --- | --- |
| Sources | 1 | list the configured JumpServer sources (never returns keys) |
| Assets | 5 | assets, details, create/update/delete |
| Users | 7 | users, details, create/update/delete, password/MFA/SSH-key reset |
| Accounts | 5 | asset accounts, details, create/update/delete |
| Permissions | 5 | asset-permission rules, details, create/update/delete |
| Sessions & Audit | 2 | terminal sessions, command audit logs |
| User Groups | 5 | groups, details, create/update/delete |
| Command Groups | 5 | command-pattern groups, details, create/update/delete |
| Command Filters | 5 | security filters, details, create/update/delete |
| Asset Tree | 6 | nodes, details, create/update/delete, move |
| RBAC | 8 | roles, bindings, create/update/delete |

See **[docs/tools.md](docs/tools.md)** for the full per-tool reference (name, method, path, description).

Session termination and ticket approval are intentionally out of scope.

## Security and data boundaries

- The AccessKeySecret never enters tool arguments, model messages, logs, or Git.
- Account secrets/passphrases and user passwords/public keys/MFA secrets are explicitly excluded from every **read** tool's output, field by field.
- Authenticated requests reject HTTP redirects to avoid forwarding signed requests to another origin.
- Non-loopback HTTP is disabled by default (see `allowInsecureHttp`).
- Requests have cooperative cancellation, timeouts, and bounded response sizes.
- Error responses expose only a bounded status/detail description.
- `id` parameters are validated as JumpServer UUIDs before being placed in a request path, preventing path injection.
- All returned fields (names, addresses, comments, usernames, etc.) are treated as untrusted data, not model instructions.

## Development

```bash
npm ci
npm run verify
```

Tests use Node's built-in test runner and mocked JumpServer responses.

## Structure

- `index.js` — generic execution engine + full endpoint catalog + write-approval gateway
- `client.js` — settings-page form card (registers `settings.section`, falling back to `settings.plugins.tab`, then the legacy `settings.plugin.item`, depending on the host)
- `cordis.patch.yml` — bundle patch (insert id `jumpserver` / name `dsh-jumpserver`)
- `docs/tools.md` — full tool reference
- `test/index.test.js` — `node:test` unit tests

## License

MIT
