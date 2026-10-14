import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { apply, Config, internals, SETTINGS_NAMESPACE, unwrapVolatile } from "../index.js";

function execution() {
  return { signal: new AbortController().signal };
}

function createContext({
  baseUrl = "https://jumpserver.example.com",
  ak = "test-ak",
  sk = "test-sk",
} = {}) {
  const tools = [];
  const sections = [];
  const listeners = new Map();
  const ctx = {
    credentials: {
      async resolve(ref) {
        if (ref === "JUMPSERVER_ACCESS_KEY_ID")
          return ak ? { value: ak } : undefined;
        if (ref === "JUMPSERVER_ACCESS_KEY_SECRET")
          return sk ? { value: sk } : undefined;
        return undefined;
      },
    },
    // 无 settings 服务时注入回调不会执行（与真实 cordis 行为一致）。
    inject() {},
    on(name, listener) {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
    systemPrompt: {
      section(section) {
        sections.push(section);
      },
    },
    tools: {
      register(tool) {
        tools.push(tool);
        return () => {};
      },
    },
  };
  apply(ctx, { baseUrl });
  return { sections, tools, listeners };
}

function toolByName(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizeBaseUrl allows HTTP out of the box and can enforce HTTPS only", () => {
  assert.equal(
    internals.normalizeBaseUrl("https://jumpserver.example.com/"),
    "https://jumpserver.example.com",
  );
  assert.equal(
    internals.normalizeBaseUrl("http://127.0.0.1:8080/"),
    "http://127.0.0.1:8080",
  );
  assert.equal(
    internals.normalizeBaseUrl("http://jumpserver.internal/"),
    "http://jumpserver.internal",
  );
  assert.equal(
    internals.normalizeBaseUrl("http://jumpserver.internal/", true),
    "http://jumpserver.internal",
  );
  assert.throws(
    () => internals.normalizeBaseUrl("http://jumpserver.internal/", false),
    /Plain HTTP is disabled/,
  );
  assert.throws(
    () =>
      internals.normalizeBaseUrl("https://user:pass@jumpserver.example.com"),
    /embedded credentials/,
  );
  assert.throws(
    () => internals.normalizeBaseUrl("https://jumpserver.example.com?target=x"),
    /query string or fragment/,
  );
  assert.throws(() => internals.normalizeBaseUrl(""), /not configured/);
});

test("readLimitedText rejects oversized responses", async () => {
  await assert.rejects(
    internals.readLimitedText(new Response("123456"), 4),
    /exceeds the 4-byte limit/,
  );
});

test("safeApiErrorDetail exposes only bounded status/detail/message fields", () => {
  const detail = internals.safeApiErrorDetail(
    JSON.stringify({
      detail: "invalid signature",
      code: "auth_failed",
      secret: "must-not-leak",
    }),
  );
  assert.equal(detail, "invalid signature: auth_failed");
});

test("clampInt clamps to bounds and falls back on invalid input", () => {
  assert.equal(internals.clampInt("50", 20, 1, 100), 50);
  assert.equal(internals.clampInt("500", 20, 1, 100), 100);
  assert.equal(internals.clampInt("-5", 20, 0, 100), 0);
  assert.equal(internals.clampInt("not-a-number", 20, 1, 100), 20);
  assert.equal(internals.clampInt(undefined, 20, 1, 100), 20);
});

test("buildSignatureHeader produces a draft-cavage hmac-sha256 signature over (request-target) accept date", () => {
  const headers = {
    accept: "application/json",
    date: "Wed, 20 Aug 2026 09:00:00 GMT",
  };
  const header = internals.buildSignatureHeader({
    keyId: "AK123",
    secret: "SK456",
    method: "GET",
    path: "/api/v1/assets/assets/?limit=20&offset=0",
    headers,
  });
  const expectedSigningString = [
    "(request-target): get /api/v1/assets/assets/?limit=20&offset=0",
    "accept: application/json",
    "date: Wed, 20 Aug 2026 09:00:00 GMT",
  ].join("\n");
  const expectedSignature = createHmac("sha256", "SK456")
    .update(expectedSigningString, "utf8")
    .digest("base64");
  assert.equal(
    header,
    `Signature keyId="AK123",algorithm="hmac-sha256",headers="(request-target) accept date",signature="${expectedSignature}"`,
  );
});

test("gmtNow returns an RFC 1123 / GMT formatted date string", () => {
  assert.match(
    internals.gmtNow(),
    /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  );
});

test("apply registers all tools (read-only + write) and a system prompt section", () => {
  const { sections, tools } = createContext();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "jumpserver_list_assets",
      "jumpserver_get_asset",
      "jumpserver_list_users",
      "jumpserver_get_user",
      "jumpserver_list_accounts",
      "jumpserver_get_account",
      "jumpserver_list_permissions",
      "jumpserver_get_permission",
      "jumpserver_list_sessions",
      "jumpserver_create_asset",
      "jumpserver_update_asset",
      "jumpserver_delete_asset",
      "jumpserver_create_account",
      "jumpserver_update_account",
      "jumpserver_delete_account",
      "jumpserver_create_user",
      "jumpserver_delete_user",
      "jumpserver_update_user",
      "jumpserver_reset_user_mfa",
      "jumpserver_reset_user_ssh_key",
      "jumpserver_create_permission",
      "jumpserver_update_permission",
      "jumpserver_delete_permission",
      "jumpserver_list_commands",
      "jumpserver_list_user_groups",
      "jumpserver_get_user_group",
      "jumpserver_create_user_group",
      "jumpserver_update_user_group",
      "jumpserver_delete_user_group",
      "jumpserver_list_command_groups",
      "jumpserver_get_command_group",
      "jumpserver_create_command_group",
      "jumpserver_update_command_group",
      "jumpserver_delete_command_group",
      "jumpserver_list_command_filters",
      "jumpserver_get_command_filter",
      "jumpserver_create_command_filter",
      "jumpserver_update_command_filter",
      "jumpserver_delete_command_filter",
      "jumpserver_list_nodes",
      "jumpserver_get_node",
      "jumpserver_create_node",
      "jumpserver_update_node",
      "jumpserver_delete_node",
      "jumpserver_move_node",
      "jumpserver_list_roles",
      "jumpserver_get_role",
      "jumpserver_create_role",
      "jumpserver_update_role",
      "jumpserver_delete_role",
      "jumpserver_list_role_bindings",
      "jumpserver_create_role_binding",
      "jumpserver_delete_role_binding",
    ],
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "tool:jumpserver");
});

test("jumpserver_list_assets sends a signed GET request and formats results", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: "uuid-1",
          name: "web-01",
          address: "10.0.0.1",
          platform: "Linux",
          category: { value: "host", label: "主机" },
          type: { value: "linux", label: "Linux" },
          is_active: true,
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_assets");
    const output = await list.execute({ search: "web" }, execution());
    assert.match(output, /count=1/);
    assert.match(output, /name="web-01"/);
    assert.match(output, /address="10\.0\.0\.1"/);
    assert.equal(calls.length, 1);
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.origin, "https://jumpserver.example.com");
    assert.equal(requestUrl.pathname, "/api/v1/assets/assets/");
    assert.equal(requestUrl.searchParams.get("search"), "web");
    assert.equal(requestUrl.searchParams.get("limit"), "20");
    assert.equal(requestUrl.searchParams.get("offset"), "0");
    assert.equal(calls[0].init.redirect, "error");
    assert.match(
      calls[0].init.headers.Authorization,
      /^Signature keyId="test-ak",algorithm="hmac-sha256",headers="\(request-target\) accept date",signature="[^"]+"$/,
    );
    assert.ok(calls[0].init.headers.Date);
    assert.equal(calls[0].init.headers.Accept, "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_assets clamps limit/offset and omits empty search", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ count: 0, results: [] });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_assets");
    const output = await list.execute({ limit: 1000, offset: -5 }, execution());
    assert.equal(output, "(no results found)");
    const requestUrl = new URL(calls[0]);
    assert.equal(requestUrl.searchParams.get("limit"), "100");
    assert.equal(requestUrl.searchParams.get("offset"), "0");
    assert.equal(requestUrl.searchParams.has("search"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_assets surfaces bounded API error details on non-2xx responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({ detail: "Invalid signature." }, 401);
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_assets");
    await assert.rejects(
      list.execute({}, execution()),
      /401.*Invalid signature/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_assets fails clearly when AccessKey credentials are missing", async () => {
  const { tools } = createContext({ ak: "", sk: "" });
  const list = toolByName(tools, "jumpserver_list_assets");
  await assert.rejects(
    list.execute({}, execution()),
    /JUMPSERVER_ACCESS_KEY_ID.*not configured/,
  );
});

test("requireId accepts JumpServer UUIDs and rejects anything else (path injection guard)", () => {
  assert.equal(
    internals.requireId("123e4567-e89b-12d3-a456-426614174000", "id"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.throws(
    () => internals.requireId("../assets/other-id", "id"),
    /must be a valid JumpServer UUID/,
  );
  assert.throws(
    () => internals.requireId("not-a-uuid", "id"),
    /must be a valid JumpServer UUID/,
  );
  assert.throws(
    () => internals.requireId("", "id"),
    /must be a valid JumpServer UUID/,
  );
});

test("jumpserver_get_asset fetches a single asset by id and rejects malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "web-01",
      address: "10.0.0.1",
      platform: "Linux",
      category: { label: "主机" },
      type: { label: "Linux" },
      domain: null,
      protocols: [{ name: "ssh", port: 22 }],
      is_active: true,
      comment: "",
    });
  };
  try {
    const { tools } = createContext();
    const get = toolByName(tools, "jumpserver_get_asset");
    const output = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /name="web-01"/);
    assert.match(output, /protocols="ssh:22"/);
    const requestUrl = new URL(calls[0]);
    assert.equal(
      requestUrl.pathname,
      "/api/v1/assets/assets/123e4567-e89b-12d3-a456-426614174000/",
    );
    await assert.rejects(
      get.execute({ id: "../etc/passwd" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_users never surfaces password, public_key, or MFA secret fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      count: 1,
      results: [
        {
          id: "u1",
          username: "alice",
          name: "Alice",
          email: "alice@example.com",
          is_active: true,
          is_superuser: false,
          source: "local",
          password: "must-not-leak",
          public_key: "ssh-rsa MUST-NOT-LEAK",
        },
      ],
    });
  try {
    const { tools } = createContext();
    const output = await toolByName(tools, "jumpserver_list_users").execute(
      {},
      execution(),
    );
    assert.match(output, /username="alice"/);
    assert.doesNotMatch(output, /must-not-leak/);
    assert.doesNotMatch(output, /password/);
    assert.doesNotMatch(output, /public_key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_get_user never surfaces password, public_key, or MFA secret fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      id: "u1",
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
      phone: "",
      source: "local",
      is_active: true,
      is_superuser: false,
      is_org_admin: false,
      mfa_enabled: false,
      is_valid: true,
      is_expired: false,
      last_login: null,
      comment: "",
      password: "must-not-leak",
      public_key: "ssh-rsa MUST-NOT-LEAK",
    });
  try {
    const { tools } = createContext();
    const output = await toolByName(tools, "jumpserver_get_user").execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /username="alice"/);
    assert.doesNotMatch(output, /must-not-leak/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_accounts never surfaces secret or passphrase fields, and validates asset filter", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      count: 1,
      results: [
        {
          id: "a1",
          name: "root account",
          username: "root",
          asset: "asset-1",
          secret_type: "password",
          privileged: true,
          is_active: true,
          source: "local",
          secret: "must-not-leak",
          passphrase: "must-not-leak-either",
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_accounts");
    const output = await list.execute(
      { asset: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /username="root"/);
    assert.doesNotMatch(output, /must-not-leak/);
    assert.doesNotMatch(output, /secret=/);
    assert.doesNotMatch(output, /passphrase/);
    const requestUrl = new URL(calls[0]);
    assert.equal(
      requestUrl.searchParams.get("asset"),
      "123e4567-e89b-12d3-a456-426614174000",
    );
    await assert.rejects(
      list.execute({ asset: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_get_account never surfaces the secret or passphrase field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      id: "a1",
      name: "root account",
      username: "root",
      asset: "asset-1",
      secret_type: "password",
      privileged: true,
      is_active: true,
      source: "local",
      connectivity: "ok",
      comment: "",
      secret: "must-not-leak",
      passphrase: "must-not-leak-either",
    });
  try {
    const { tools } = createContext();
    const output = await toolByName(tools, "jumpserver_get_account").execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /username="root"/);
    assert.doesNotMatch(output, /must-not-leak/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_permissions validates userId/assetId filters and formats rows", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      count: 1,
      results: [
        {
          id: "p1",
          name: "dev-access",
          is_active: true,
          is_valid: true,
          is_expired: false,
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_permissions");
    const output = await list.execute(
      { userId: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /name="dev-access"/);
    const requestUrl = new URL(calls[0]);
    assert.equal(
      requestUrl.searchParams.get("user_id"),
      "123e4567-e89b-12d3-a456-426614174000",
    );
    await assert.rejects(
      list.execute({ assetId: "bad" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_get_permission expands referenced users/assets/accounts and flags @ALL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      id: "p1",
      name: "Role-alice",
      is_active: true,
      is_valid: true,
      is_expired: false,
      users: [
        { id: "u1", name: "alice" },
        { id: "u2", name: "bob" },
      ],
      user_groups: [{ id: "g1", name: "devs" }],
      assets: [{ id: "a1", name: "web-01", address: "10.0.0.1" }],
      nodes: [{ id: "n1", full_value: "/Default/prod" }],
      accounts: ["@ALL"],
      comment: "granted manually",
    });
  };
  try {
    const { tools } = createContext();
    const get = toolByName(tools, "jumpserver_get_permission");
    const output = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /name="Role-alice"/);
    assert.match(output, /users_count=2/);
    assert.match(output, /users="alice, bob"/);
    assert.match(output, /user_groups="devs"/);
    assert.match(output, /assets="web-01"/);
    assert.match(output, /nodes="\/Default\/prod"/);
    // accounts 含 "@ALL" 时必须明确标注为授权全部账号。
    assert.match(output, /accounts="@ALL \(all accounts\)"/);
    const requestUrl = new URL(calls[0]);
    assert.match(
      requestUrl.pathname,
      /\/api\/v1\/perms\/asset-permissions\/123e4567-e89b-12d3-a456-426614174000\/$/,
    );
    await assert.rejects(
      get.execute({ id: "bad" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_sessions filters by user/asset/isFinished and formats rows", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      count: 1,
      results: [
        {
          id: "s1",
          user: "alice",
          asset: "web-01",
          account: "root",
          protocol: "ssh",
          is_success: true,
          is_finished: true,
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_sessions");
    const output = await list.execute(
      { user: "alice", isFinished: true },
      execution(),
    );
    assert.match(output, /user="alice"/);
    const requestUrl = new URL(calls[0]);
    assert.equal(requestUrl.searchParams.get("user"), "alice");
    assert.equal(requestUrl.searchParams.get("is_finished"), "true");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WRITE_TOOL_NAMES lists exactly the thirty-four write tools", () => {
  assert.deepEqual([...internals.WRITE_TOOL_NAMES].sort(), [
    "jumpserver_create_account",
    "jumpserver_create_asset",
    "jumpserver_create_command_filter",
    "jumpserver_create_command_group",
    "jumpserver_create_domain",
    "jumpserver_create_gateway",
    "jumpserver_create_label",
    "jumpserver_create_node",
    "jumpserver_create_permission",
    "jumpserver_create_role",
    "jumpserver_create_role_binding",
    "jumpserver_create_user",
    "jumpserver_create_user_group",
    "jumpserver_delete_account",
    "jumpserver_delete_asset",
    "jumpserver_delete_command_filter",
    "jumpserver_delete_command_group",
    "jumpserver_delete_domain",
    "jumpserver_delete_gateway",
    "jumpserver_delete_label",
    "jumpserver_delete_node",
    "jumpserver_delete_permission",
    "jumpserver_delete_role",
    "jumpserver_delete_role_binding",
    "jumpserver_delete_user",
    "jumpserver_delete_user_group",
    "jumpserver_move_node",
    "jumpserver_reset_user_mfa",
    "jumpserver_reset_user_ssh_key",
    "jumpserver_update_account",
    "jumpserver_update_asset",
    "jumpserver_update_command_filter",
    "jumpserver_update_command_group",
    "jumpserver_update_domain",
    "jumpserver_update_gateway",
    "jumpserver_update_label",
    "jumpserver_update_node",
    "jumpserver_update_permission",
    "jumpserver_update_role",
    "jumpserver_update_user",
    "jumpserver_update_user_group",
  ]);
});

test("approvalReasonForWrite describes create/update/delete from arguments only (no extra fetch)", () => {
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_create_asset",
      arguments: { name: "web-02", address: "10.0.0.2", platform: "Linux" },
    }),
    /创建新的 JumpServer 资产：name="web-02"，address="10\.0\.0\.2"，platform="Linux"/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_update_asset",
      arguments: { id: "abc-123", comment: "retiring soon" },
    }),
    /更新 JumpServer 资产 id=abc-123。变更：comment="retiring soon"。/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_delete_asset",
      arguments: { id: "abc-123" },
    }),
    /永久删除 JumpServer 资产 id=abc-123.*不可撤销/,
  );
});

test("approvalReasonForWrite never includes the literal secret/passphrase value for account writes", () => {
  const createReason = internals.approvalReasonForWrite({
    name: "jumpserver_create_account",
    arguments: {
      username: "root",
      asset: "asset-1",
      secret: "super-secret-value",
    },
  });
  assert.match(createReason, /username="root"/);
  assert.match(createReason, /包含密钥\/密码值/);
  assert.doesNotMatch(createReason, /super-secret-value/);

  const createReasonNoSecret = internals.approvalReasonForWrite({
    name: "jumpserver_create_account",
    arguments: { username: "root", asset: "asset-1" },
  });
  assert.match(createReasonNoSecret, /未提供密钥\/密码/);

  const updateReason = internals.approvalReasonForWrite({
    name: "jumpserver_update_account",
    arguments: {
      id: "acc-1",
      secret: "rotated-secret-value",
      passphrase: "also-secret",
    },
  });
  assert.match(updateReason, /同时变更密钥\/密码值/);
  assert.doesNotMatch(updateReason, /rotated-secret-value/);
  assert.doesNotMatch(updateReason, /also-secret/);

  const deleteReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_account",
    arguments: { id: "acc-1" },
  });
  assert.match(deleteReason, /永久删除 JumpServer 账号 id=acc-1/);
});

test('the tools/pre-execute gate forces every write tool to "ask" and leaves read-only tools untouched', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");
  assert.equal(typeof gate, "function");

  const readDecision = await gate(
    { name: "jumpserver_list_assets", arguments: {} },
    async () => ({ kind: "allow" }),
  );
  assert.deepEqual(readDecision, { kind: "allow" });

  const writeDecision = await gate(
    { name: "jumpserver_delete_asset", arguments: { id: "abc-123" } },
    async () => ({ kind: "allow" }),
  );
  assert.equal(writeDecision.kind, "ask");
  assert.match(writeDecision.reason, /永久删除/);

  // 如果上游网关已经拒绝，本网关不应该把拒绝改写成 ask。
  const deniedDecision = await gate(
    { name: "jumpserver_create_asset", arguments: {} },
    async () => ({ kind: "deny", reason: "blocked upstream" }),
  );
  assert.deepEqual(deniedDecision, {
    kind: "deny",
    reason: "blocked upstream",
  });
});

test("jumpserver_create_asset requires name/address/platform and POSTs only writable fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "new-1",
        name: "web-02",
        address: "10.0.0.2",
        platform: "Linux",
        is_active: true,
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_asset");
    const output = await create.execute(
      {
        name: "web-02",
        address: "10.0.0.2",
        platform: "Linux",
        comment: "new box",
      },
      execution(),
    );
    assert.match(output, /Asset created/);
    assert.match(output, /id="new-1"/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "web-02",
      address: "10.0.0.2",
      platform: "Linux",
      comment: "new box",
    });

    await assert.rejects(
      create.execute({ address: "10.0.0.2", platform: "Linux" }, execution()),
      /missing required property "name"/,
    );
    await assert.rejects(
      create.execute({ name: "web-02", platform: "Linux" }, execution()),
      /missing required property "address"/,
    );
    await assert.rejects(
      create.execute({ name: "web-02", address: "10.0.0.2" }, execution()),
      /missing required property "platform"/,
    );
    // 框架只校验字段是否存在，不校验是否为空字符串；这里靠我们自己的检查兜底。
    await assert.rejects(
      create.execute(
        { name: "   ", address: "10.0.0.2", platform: "Linux" },
        execution(),
      ),
      /name is required/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_asset checks existence first, then PATCHes only the provided fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET") {
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "web-01",
        address: "10.0.0.1",
        platform: "Linux",
        is_active: true,
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "web-01-renamed",
      address: "10.0.0.1",
      platform: "Linux",
      is_active: true,
      comment: "",
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_asset");
    const output = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "web-01-renamed" },
      execution(),
    );
    assert.match(output, /Asset updated/);
    assert.match(output, /name="web-01-renamed"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "PATCH");
    const body = JSON.parse(calls[1].init.body);
    assert.deepEqual(body, { name: "web-01-renamed" });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute({ id: "not-a-uuid", name: "x" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_asset fails clearly when the asset does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_asset");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", name: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_asset checks existence first, reports name/address, and rejects malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "web-01",
      address: "10.0.0.1",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_asset");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Asset deleted/);
    assert.match(output, /name="web-01"/);
    assert.match(output, /address="10\.0\.0\.1"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_asset fails clearly when the asset does not exist, without attempting the DELETE", async () => {
  const originalFetch = globalThis.fetch;
  let deleteCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "DELETE") {
      deleteCount += 1;
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_asset");
    await assert.rejects(
      del.execute({ id: "123e4567-e89b-12d3-a456-426614174000" }, execution()),
      /404/,
    );
    assert.equal(deleteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_account requires username/asset, accepts a secret, and never echoes it back", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "acc-1",
        name: "root",
        username: "root",
        asset: "123e4567-e89b-12d3-a456-426614174000",
        secret_type: "password",
        privileged: true,
        is_active: true,
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_account");
    const output = await create.execute(
      {
        username: "root",
        asset: "123e4567-e89b-12d3-a456-426614174000",
        secret: "super-secret-value",
        passphrase: "passphrase-value",
        privileged: true,
      },
      execution(),
    );
    assert.match(output, /Account created/);
    assert.match(output, /username="root"/);
    assert.doesNotMatch(output, /super-secret-value/);
    assert.doesNotMatch(output, /passphrase-value/);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      username: "root",
      asset: "123e4567-e89b-12d3-a456-426614174000",
      secret: "super-secret-value",
      passphrase: "passphrase-value",
      privileged: true,
    });

    await assert.rejects(
      create.execute(
        { asset: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /missing required property "username"/,
    );
    await assert.rejects(
      create.execute({ username: "root" }, execution()),
      /missing required property "asset"/,
    );
    await assert.rejects(
      create.execute({ username: "root", asset: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_account checks existence first, PATCHes only provided fields, and never echoes a secret back", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET") {
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "root",
        asset: "asset-1",
        secret_type: "password",
        is_active: true,
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "root",
      username: "root",
      asset: "asset-1",
      secret_type: "password",
      privileged: true,
      is_active: true,
      comment: "rotated",
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_account");
    const output = await update.execute(
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        secret: "new-secret-value",
        comment: "rotated",
      },
      execution(),
    );
    assert.match(output, /Account updated/);
    assert.doesNotMatch(output, /new-secret-value/);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "PATCH");
    const body = JSON.parse(calls[1].init.body);
    assert.deepEqual(body, { secret: "new-secret-value", comment: "rotated" });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute({ id: "not-a-uuid", comment: "x" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_account fails clearly when the account does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_account");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", comment: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_account checks existence first, reports username/asset, and rejects malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "root",
      asset: "asset-1",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_account");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Account deleted/);
    assert.match(output, /username="root"/);
    assert.match(output, /asset="asset-1"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_account fails clearly when the account does not exist, without attempting the DELETE", async () => {
  const originalFetch = globalThis.fetch;
  let deleteCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "DELETE") {
      deleteCount += 1;
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_account");
    await assert.rejects(
      del.execute({ id: "123e4567-e89b-12d3-a456-426614174000" }, execution()),
      /404/,
    );
    assert.equal(deleteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the tools/pre-execute gate also forces account write tools to "ask"', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");
  for (const name of [
    "jumpserver_create_account",
    "jumpserver_update_account",
    "jumpserver_delete_account",
  ]) {
    const decision = await gate(
      { name, arguments: { id: "x", username: "x", asset: "x" } },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }
});

test("isSuperuser recognizes boolean true and the string forms JumpServer may return", () => {
  assert.equal(internals.isSuperuser({ is_superuser: true }), true);
  assert.equal(internals.isSuperuser({ is_superuser: "true" }), true);
  assert.equal(internals.isSuperuser({ is_superuser: "True" }), true);
  assert.equal(internals.isSuperuser({ is_superuser: false }), false);
  assert.equal(internals.isSuperuser({ is_superuser: "false" }), false);
  assert.equal(internals.isSuperuser({}), false);
});

test("requireNonEmptyIdArray rejects empty arrays, non-arrays, and malformed UUIDs (anti-broad-grant guard)", () => {
  assert.deepEqual(
    internals.requireNonEmptyIdArray(
      ["123e4567-e89b-12d3-a456-426614174000"],
      "assets",
    ),
    ["123e4567-e89b-12d3-a456-426614174000"],
  );
  assert.throws(
    () => internals.requireNonEmptyIdArray([], "assets"),
    /non-empty array/,
  );
  assert.throws(
    () => internals.requireNonEmptyIdArray(undefined, "assets"),
    /non-empty array/,
  );
  assert.throws(
    () => internals.requireNonEmptyIdArray("all", "assets"),
    /non-empty array/,
  );
  assert.throws(
    () => internals.requireNonEmptyIdArray(["not-a-uuid"], "assets"),
    /valid JumpServer UUID/,
  );
});

test("jumpserver_create_user requires name/username/email and never accepts a password", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "u1",
        username: "bob",
        name: "Bob",
        email: "bob@example.com",
        is_active: true,
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_user");
    const output = await create.execute(
      { name: "Bob", username: "bob", email: "bob@example.com" },
      execution(),
    );
    assert.match(output, /User created/);
    assert.match(output, /username="bob"/);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "Bob",
      username: "bob",
      email: "bob@example.com",
    });
    assert.equal("password" in body, false);

    await assert.rejects(
      create.execute(
        { username: "bob", email: "bob@example.com" },
        execution(),
      ),
      /missing required property "name"/,
    );
    await assert.rejects(
      create.execute({ name: "Bob", email: "bob@example.com" }, execution()),
      /missing required property "username"/,
    );
    await assert.rejects(
      create.execute({ name: "Bob", username: "bob" }, execution()),
      /missing required property "email"/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_user refuses to delete a superuser and checks existence first", async () => {
  const originalFetch = globalThis.fetch;
  let deleteCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "DELETE") {
      deleteCount += 1;
      return new Response(null, { status: 204 });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "admin",
      name: "Admin",
      is_superuser: true,
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_user");
    await assert.rejects(
      del.execute({ id: "123e4567-e89b-12d3-a456-426614174000" }, execution()),
      /Refusing to delete.*superuser/,
    );
    assert.equal(deleteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_user deletes a non-superuser and reports username/name", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "bob",
      name: "Bob",
      is_superuser: false,
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_user");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /User deleted/);
    assert.match(output, /username="bob"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_user refuses to change the password of a superuser, but allows other fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "PATCH")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "admin",
        name: "Admin Renamed",
        is_active: true,
      });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "admin",
      is_superuser: true,
      is_active: true,
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_user");
    await assert.rejects(
      update.execute(
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          password: "new-password-value",
        },
        execution(),
      ),
      /Refusing to reset the password.*superuser/,
    );
    assert.equal(calls.filter((c) => c.init.method === "PUT").length, 0);

    // 非密码字段仍然可以改超级管理员。
    const output = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "Admin Renamed" },
      execution(),
    );
    assert.match(output, /User updated/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_user updates a non-superuser and never echoes a changed password", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "PATCH")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "bob",
        name: "Bob Renamed",
        email: "bob@example.com",
        is_active: true,
      });
    if ((init.method ?? "GET") === "PUT") return jsonResponse({}, 200);
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "bob",
      is_superuser: false,
      is_active: true,
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_user");
    const output = await update.execute(
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Bob Renamed",
        password: "new-password-value",
      },
      execution(),
    );
    assert.match(output, /User updated/);
    assert.match(output, /username="bob"/);
    assert.match(output, /password_changed=true/);
    assert.doesNotMatch(output, /new-password-value/);

    const patchCall = calls.find((c) => c.init.method === "PATCH");
    assert.deepEqual(JSON.parse(patchCall.init.body), { name: "Bob Renamed" });
    const putCall = calls.find((c) => c.init.method === "PUT");
    assert.deepEqual(JSON.parse(putCall.init.body), {
      password: "new-password-value",
    });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute({ id: "not-a-uuid", name: "x" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_user fails clearly when the user does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_user");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", name: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_reset_user_mfa refuses to act on a superuser and checks existence first", async () => {
  const originalFetch = globalThis.fetch;
  let resetCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/mfa/reset/")) {
      resetCount += 1;
      return jsonResponse({ msg: "ok" });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "admin",
      is_superuser: true,
    });
  };
  try {
    const { tools } = createContext();
    const reset = toolByName(tools, "jumpserver_reset_user_mfa");
    await assert.rejects(
      reset.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Refusing to reset MFA.*superuser/,
    );
    assert.equal(resetCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_reset_user_mfa resets MFA for a non-superuser and reports the username", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/mfa/reset/")) return jsonResponse({ msg: "ok" });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "bob",
      is_superuser: false,
    });
  };
  try {
    const { tools } = createContext();
    const reset = toolByName(tools, "jumpserver_reset_user_mfa");
    const output = await reset.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /MFA reset/);
    assert.match(output, /username="bob"/);
    assert.equal(calls.length, 2);
    assert.match(new URL(calls[1]).pathname, /\/mfa\/reset\/$/);

    await assert.rejects(
      reset.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_reset_user_ssh_key refuses to act on a superuser and checks existence first", async () => {
  const originalFetch = globalThis.fetch;
  let putCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PUT") {
      putCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "admin",
      is_superuser: true,
    });
  };
  try {
    const { tools } = createContext();
    const reset = toolByName(tools, "jumpserver_reset_user_ssh_key");
    await assert.rejects(
      reset.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Refusing to reset the SSH key.*superuser/,
    );
    assert.equal(putCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_reset_user_ssh_key resets the key for a non-superuser and reports the username", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "PUT") return jsonResponse({}, 200);
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      username: "bob",
      is_superuser: false,
    });
  };
  try {
    const { tools } = createContext();
    const reset = toolByName(tools, "jumpserver_reset_user_ssh_key");
    const output = await reset.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /SSH key reset/);
    assert.match(output, /username="bob"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].init.body), {});

    await assert.rejects(
      reset.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_permission requires non-empty users/assets/accounts and rejects broad grants", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "p1",
        name: "dev-access",
        users: ["u1"],
        user_groups: [],
        assets: ["a1"],
        accounts: ["acc1"],
        is_active: true,
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_permission");
    const output = await create.execute(
      {
        name: "dev-access",
        users: ["123e4567-e89b-12d3-a456-426614174000"],
        assets: ["223e4567-e89b-12d3-a456-426614174000"],
        accounts: ["323e4567-e89b-12d3-a456-426614174000"],
      },
      execution(),
    );
    assert.match(output, /Permission rule created/);
    assert.match(output, /name="dev-access"/);

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "dev-access",
      users: ["123e4567-e89b-12d3-a456-426614174000"],
      assets: ["223e4567-e89b-12d3-a456-426614174000"],
      accounts: ["323e4567-e89b-12d3-a456-426614174000"],
    });

    // 缺少 users/userGroups：拒绝。
    await assert.rejects(
      create.execute(
        {
          name: "no-grantee",
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: ["323e4567-e89b-12d3-a456-426614174000"],
        },
        execution(),
      ),
      /Provide at least one of users or userGroups/,
    );

    // assets 缺失（框架必填校验）。
    await assert.rejects(
      create.execute(
        {
          name: "no-assets",
          users: ["123e4567-e89b-12d3-a456-426614174000"],
          accounts: ["323e4567-e89b-12d3-a456-426614174000"],
        },
        execution(),
      ),
      /missing required property "assets"/,
    );

    // accounts 传空数组：视为宽泛授权，拒绝。
    await assert.rejects(
      create.execute(
        {
          name: "broad-accounts",
          users: ["123e4567-e89b-12d3-a456-426614174000"],
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: [],
        },
        execution(),
      ),
      /non-empty array/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_permission checks existence first and rejects clearing arrays to empty", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "dev-access",
      });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "dev-access-renamed",
      users: ["u1"],
      user_groups: [],
      assets: ["a1"],
      accounts: ["acc1"],
      is_active: true,
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_permission");
    const output = await update.execute(
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "dev-access-renamed",
      },
      execution(),
    );
    assert.match(output, /Permission rule updated/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "PATCH");
    const body = JSON.parse(calls[1].init.body);
    assert.deepEqual(body, { name: "dev-access-renamed" });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", assets: [] },
        execution(),
      ),
      /non-empty array/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_permission fails clearly when the rule does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_permission");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", name: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_permission checks existence first and reports the rule name", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "dev-access",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_permission");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Permission rule deleted/);
    assert.match(output, /name="dev-access"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("approvalReasonForWrite never includes the literal password for user updates, and describes MFA/SSH key resets", () => {
  const updateReason = internals.approvalReasonForWrite({
    name: "jumpserver_update_user",
    arguments: { id: "u1", name: "Bob", password: "super-secret-password" },
  });
  assert.match(updateReason, /更新 JumpServer 用户 id=u1/);
  assert.match(updateReason, /同时将登录密码重置为新值/);
  assert.doesNotMatch(updateReason, /super-secret-password/);

  const updateReasonNoPassword = internals.approvalReasonForWrite({
    name: "jumpserver_update_user",
    arguments: { id: "u1", isActive: false },
  });
  assert.doesNotMatch(updateReasonNoPassword, /将登录密码重置为新值/);

  const mfaReason = internals.approvalReasonForWrite({
    name: "jumpserver_reset_user_mfa",
    arguments: { id: "u1" },
  });
  assert.match(mfaReason, /重置 JumpServer 用户 id=u1 的 MFA\/OTP 绑定/);

  const sshReason = internals.approvalReasonForWrite({
    name: "jumpserver_reset_user_ssh_key",
    arguments: { id: "u1" },
  });
  assert.match(sshReason, /重置 JumpServer 用户 id=u1 的登录 SSH 公钥/);
});

test("approvalReasonForWrite summarizes permission grants by counts, and flags deletes as irreversible", () => {
  const createReason = internals.approvalReasonForWrite({
    name: "jumpserver_create_permission",
    arguments: {
      name: "dev-access",
      users: ["u1"],
      userGroups: [],
      assets: ["a1", "a2"],
      accounts: ["acc1"],
    },
  });
  assert.match(createReason, /name="dev-access"/);
  assert.match(
    createReason,
    /授予 1 个用户和 0 个用户组通过 1 个账号访问 2 个资产的权限/,
  );

  const deleteReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_permission",
    arguments: { id: "p1" },
  });
  assert.match(deleteReason, /永久删除 JumpServer 资产授权规则 id=p1/);
  assert.match(deleteReason, /不可撤销/);

  const deleteUserReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_user",
    arguments: { id: "u1" },
  });
  assert.match(deleteUserReason, /永久删除 JumpServer 用户 id=u1/);
});

test('the tools/pre-execute gate also forces user and permission write tools to "ask"', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");
  const names = [
    "jumpserver_create_user",
    "jumpserver_delete_user",
    "jumpserver_update_user",
    "jumpserver_reset_user_mfa",
    "jumpserver_reset_user_ssh_key",
    "jumpserver_create_permission",
    "jumpserver_update_permission",
    "jumpserver_delete_permission",
  ];
  for (const name of names) {
    const decision = await gate({ name, arguments: { id: "x" } }, async () => ({
      kind: "allow",
    }));
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }
});

test("riskLevelLabel maps known JumpServer risk level codes and falls back to the raw value", () => {
  assert.equal(internals.riskLevelLabel(0), "accepted");
  assert.equal(internals.riskLevelLabel(5), "rejected");
  assert.equal(internals.riskLevelLabel(4), "warning");
  assert.equal(internals.riskLevelLabel(99), "99");
  assert.equal(internals.riskLevelLabel(undefined), "");
});

test("truncateForDisplay bounds long command output and leaves short output untouched", () => {
  assert.equal(internals.truncateForDisplay("short"), "short");
  const long = "x".repeat(600);
  const truncated = internals.truncateForDisplay(long);
  assert.ok(truncated.length < long.length);
  assert.match(truncated, /\[truncated\]$/);
  assert.equal(internals.truncateForDisplay("exact", 5), "exact");
});

test("jumpserver_list_commands filters by asset/account/user/sessionId/riskLevel and truncates long output", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      count: 1,
      results: [
        {
          id: "c1",
          user: "alice",
          asset: "web-01",
          account: "root",
          input: "x".repeat(600),
          risk_level: 5,
          timestamp_display: "2026-08-21 10:00:00",
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_commands");
    const output = await list.execute(
      {
        asset: "web-01",
        account: "root",
        user: "alice",
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        riskLevel: 5,
      },
      execution(),
    );
    assert.match(output, /user="alice"/);
    assert.match(output, /risk_level="rejected"/);
    assert.match(output, /\[truncated\]/);

    const requestUrl = new URL(calls[0]);
    assert.equal(requestUrl.pathname, "/api/v1/terminal/commands/");
    assert.equal(requestUrl.searchParams.get("asset"), "web-01");
    assert.equal(requestUrl.searchParams.get("account"), "root");
    assert.equal(requestUrl.searchParams.get("user"), "alice");
    assert.equal(
      requestUrl.searchParams.get("session"),
      "123e4567-e89b-12d3-a456-426614174000",
    );
    assert.equal(requestUrl.searchParams.get("risk_level"), "5");

    await assert.rejects(
      list.execute({ sessionId: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_user_groups and jumpserver_get_user_group format results and reject malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (new URL(String(url)).pathname === "/api/v1/users/groups/") {
      return jsonResponse({
        count: 1,
        results: [
          { id: "g1", name: "devops", users: ["u1", "u2"], comment: "" },
        ],
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "devops",
      users: ["u1", "u2"],
      comment: "ops team",
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_user_groups");
    const listOutput = await list.execute({}, execution());
    assert.match(listOutput, /name="devops"/);
    assert.match(listOutput, /member_count=2/);

    const get = toolByName(tools, "jumpserver_get_user_group");
    const getOutput = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(getOutput, /name="devops"/);
    assert.match(getOutput, /users="u1,u2"/);

    await assert.rejects(
      get.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_user_group requires name and validates optional members as UUIDs", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "g1",
        name: "devops",
        users: ["123e4567-e89b-12d3-a456-426614174000"],
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_user_group");
    const output = await create.execute(
      { name: "devops", users: ["123e4567-e89b-12d3-a456-426614174000"] },
      execution(),
    );
    assert.match(output, /User group created/);
    assert.match(output, /name="devops"/);

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "devops",
      users: ["123e4567-e89b-12d3-a456-426614174000"],
    });

    await assert.rejects(
      create.execute({}, execution()),
      /missing required property "name"/,
    );
    await assert.rejects(
      create.execute({ name: "   " }, execution()),
      /name is required/,
    );
    await assert.rejects(
      create.execute({ name: "devops", users: ["not-a-uuid"] }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_user_group checks existence first and rejects clearing members to empty", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "devops",
      });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "devops-renamed",
      users: ["u1"],
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_user_group");
    const output = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "devops-renamed" },
      execution(),
    );
    assert.match(output, /User group updated/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "PATCH");
    const body = JSON.parse(calls[1].init.body);
    assert.deepEqual(body, { name: "devops-renamed" });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", users: [] },
        execution(),
      ),
      /non-empty array/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_user_group fails clearly when the group does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_user_group");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", name: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_user_group checks existence first and reports the group name", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "devops",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_user_group");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /User group deleted/);
    assert.match(output, /name="devops"/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the tools/pre-execute gate also forces user-group write tools to "ask", and command/group reads are untouched', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");

  for (const name of [
    "jumpserver_create_user_group",
    "jumpserver_update_user_group",
    "jumpserver_delete_user_group",
  ]) {
    const decision = await gate(
      { name, arguments: { id: "x", name: "x" } },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }

  for (const name of [
    "jumpserver_list_commands",
    "jumpserver_list_user_groups",
    "jumpserver_get_user_group",
  ]) {
    const decision = await gate({ name, arguments: {} }, async () => ({
      kind: "allow",
    }));
    assert.deepEqual(
      decision,
      { kind: "allow" },
      `${name} is read-only and should not require approval`,
    );
  }
});

test('requireIdsScope wraps a non-empty UUID array into {type: "ids", ids: [...]} and rejects broad/malformed input', () => {
  assert.deepEqual(
    internals.requireIdsScope(
      ["123e4567-e89b-12d3-a456-426614174000"],
      "users",
    ),
    { type: "ids", ids: ["123e4567-e89b-12d3-a456-426614174000"] },
  );
  assert.throws(
    () => internals.requireIdsScope([], "users"),
    /non-empty array/,
  );
  assert.throws(
    () => internals.requireIdsScope({ type: "all" }, "users"),
    /specific list of JumpServer UUIDs/,
  );
  assert.throws(
    () => internals.requireIdsScope("all", "users"),
    /specific list of JumpServer UUIDs/,
  );
  assert.throws(
    () => internals.requireIdsScope(["not-a-uuid"], "users"),
    /valid JumpServer UUID/,
  );
});

test('requireAccountIds allows ["@ALL"], rejects empty input and mixing @ALL with UUIDs, accepts specific UUIDs', () => {
  assert.deepEqual(
    internals.requireAccountIds(
      ["123e4567-e89b-12d3-a456-426614174000"],
      "accounts",
    ),
    ["123e4567-e89b-12d3-a456-426614174000"],
  );
  assert.deepEqual(internals.requireAccountIds(["@ALL"], "accounts"), ["@ALL"]);
  assert.deepEqual(internals.requireAccountIds(["@all"], "accounts"), ["@ALL"]);
  assert.throws(
    () =>
      internals.requireAccountIds(
        ["@ALL", "123e4567-e89b-12d3-a456-426614174000"],
        "accounts",
      ),
    /cannot mix/,
  );
  assert.throws(
    () => internals.requireAccountIds([], "accounts"),
    /non-empty array/,
  );
  assert.throws(
    () => internals.requireAccountIds(undefined, "accounts"),
    /non-empty array/,
  );
});

test("scopeSummary and accountsSummary format the JumpServer ACL scope-selector shape for display", () => {
  assert.equal(internals.scopeSummary({ type: "all" }), "all");
  assert.equal(
    internals.scopeSummary({ type: "ids", ids: ["a", "b"] }),
    "2 specific",
  );
  assert.equal(internals.accountsSummary(["@ALL"]), "all");
  assert.equal(internals.accountsSummary(["id1", "id2"]), "2 specific");
});

test("jumpserver_list_command_groups and jumpserver_get_command_group format results and reject malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(String(url)).pathname === "/api/v1/acls/command-groups/") {
      return jsonResponse({
        count: 1,
        results: [
          {
            id: "g1",
            name: "危险命令",
            type: { value: "command", label: "命令" },
            ignore_case: true,
          },
        ],
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "危险命令",
      type: { value: "command", label: "命令" },
      content: "rm -rf *\nshutdown",
      ignore_case: true,
      comment: "",
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_command_groups");
    const listOutput = await list.execute({}, execution());
    assert.match(listOutput, /name="危险命令"/);

    const get = toolByName(tools, "jumpserver_get_command_group");
    const getOutput = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(getOutput, /content="rm -rf \*\\nshutdown"/);

    await assert.rejects(
      get.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_command_group requires name/content and POSTs only writable fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      { id: "g1", name: "危险命令", type: { value: "command", label: "命令" } },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_command_group");
    const output = await create.execute(
      { name: "危险命令", content: "rm -rf *", ignoreCase: true },
      execution(),
    );
    assert.match(output, /Command group created/);

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "危险命令",
      content: "rm -rf *",
      ignore_case: true,
    });

    await assert.rejects(
      create.execute({ content: "x" }, execution()),
      /missing required property "name"/,
    );
    await assert.rejects(
      create.execute({ name: "x" }, execution()),
      /missing required property "content"/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_command_group checks existence first and jumpserver_delete_command_group reports the name", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "PATCH")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "危险命令-v2",
        type: { value: "command", label: "命令" },
      });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "危险命令",
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_command_group");
    const updateOutput = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "危险命令-v2" },
      execution(),
    );
    assert.match(updateOutput, /Command group updated/);
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );

    const del = toolByName(tools, "jumpserver_delete_command_group");
    const deleteOutput = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(deleteOutput, /Command group deleted/);
    assert.match(deleteOutput, /name="危险命令"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_command_filters and jumpserver_get_command_filter format the ACL scope selector for display", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(String(url)).pathname === "/api/v1/acls/command-filter-acls/") {
      return jsonResponse({
        count: 1,
        results: [
          {
            id: "f1",
            name: "全员禁止",
            priority: 50,
            action: { value: "reject", label: "拒绝" },
            users: { type: "all" },
            assets: { type: "all" },
            accounts: ["@ALL"],
            command_groups: [{ id: "g1", name: "危险命令" }],
            is_active: true,
          },
        ],
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "临时规则",
      priority: 5,
      action: { value: "accept", label: "接受" },
      users: { type: "ids", ids: ["c39f134a-46ea-4306-9ca4-4eee4bae7b01"] },
      assets: { type: "all" },
      accounts: ["@ALL"],
      command_groups: [
        { id: "g1", name: "危险命令" },
        { id: "g2", name: "重启命令" },
      ],
      is_active: true,
      comment: "temp",
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_command_filters");
    const listOutput = await list.execute({}, execution());
    assert.match(listOutput, /name="全员禁止"/);
    assert.match(listOutput, /users="all"/);
    assert.match(listOutput, /accounts="all"/);

    const get = toolByName(tools, "jumpserver_get_command_filter");
    const getOutput = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(getOutput, /users="1 specific"/);
    assert.match(getOutput, /command_groups="危险命令,重启命令"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_command_filter requires non-empty users/assets/accounts/commandGroupIds and rejects broad scope", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "f1",
        name: "dev-filter",
        action: { value: "reject", label: "拒绝" },
        users: { type: "ids", ids: ["u1"] },
        assets: { type: "ids", ids: ["a1"] },
        accounts: ["acc1"],
        is_active: true,
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_command_filter");
    const output = await create.execute(
      {
        name: "dev-filter",
        users: ["123e4567-e89b-12d3-a456-426614174000"],
        assets: ["223e4567-e89b-12d3-a456-426614174000"],
        accounts: ["323e4567-e89b-12d3-a456-426614174000"],
        commandGroupIds: ["423e4567-e89b-12d3-a456-426614174000"],
      },
      execution(),
    );
    assert.match(output, /Command filter created/);

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      name: "dev-filter",
      users: { type: "ids", ids: ["123e4567-e89b-12d3-a456-426614174000"] },
      assets: { type: "ids", ids: ["223e4567-e89b-12d3-a456-426614174000"] },
      accounts: ["323e4567-e89b-12d3-a456-426614174000"],
      command_groups: ["423e4567-e89b-12d3-a456-426614174000"],
      action: "reject",
    });

    // 缺少 commandGroupIds（框架必填校验）。
    await assert.rejects(
      create.execute(
        {
          name: "x",
          users: ["123e4567-e89b-12d3-a456-426614174000"],
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: ["323e4567-e89b-12d3-a456-426614174000"],
        },
        execution(),
      ),
      /missing required property "commandGroupIds"/,
    );

    // accounts 传 @ALL：允许（宽泛授权），body 原样透传。
    const allOut = await create.execute(
      {
        name: "x",
        users: ["123e4567-e89b-12d3-a456-426614174000"],
        assets: ["223e4567-e89b-12d3-a456-426614174000"],
        accounts: ["@ALL"],
        commandGroupIds: ["423e4567-e89b-12d3-a456-426614174000"],
      },
      execution(),
    );
    assert.match(allOut, /Command filter created/);
    assert.deepEqual(JSON.parse(calls[1].init.body).accounts, ["@ALL"]);

    // accounts 混用 @ALL + 具体 UUID：拒绝。
    await assert.rejects(
      create.execute(
        {
          name: "x",
          users: ["123e4567-e89b-12d3-a456-426614174000"],
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: ["@ALL", "323e4567-e89b-12d3-a456-426614174000"],
          commandGroupIds: ["423e4567-e89b-12d3-a456-426614174000"],
        },
        execution(),
      ),
      /cannot mix/,
    );

    // users 传空数组：拒绝。
    await assert.rejects(
      create.execute(
        {
          name: "x",
          users: [],
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: ["323e4567-e89b-12d3-a456-426614174000"],
          commandGroupIds: ["423e4567-e89b-12d3-a456-426614174000"],
        },
        execution(),
      ),
      /non-empty array/,
    );

    await assert.rejects(
      create.execute(
        {
          name: "x",
          users: ["123e4567-e89b-12d3-a456-426614174000"],
          assets: ["223e4567-e89b-12d3-a456-426614174000"],
          accounts: ["323e4567-e89b-12d3-a456-426614174000"],
          commandGroupIds: ["423e4567-e89b-12d3-a456-426614174000"],
          action: "bogus",
        },
        execution(),
      ),
      /action must be/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_command_filter checks existence first and allows @ALL accounts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "临时规则",
      });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "临时规则",
      action: { value: "accept", label: "接受" },
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_command_filter");
    const output = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", action: "accept" },
      execution(),
    );
    assert.match(output, /Command filter updated/);
    const patchCall = calls.find((c) => c.init.method === "PATCH");
    assert.deepEqual(JSON.parse(patchCall.init.body), { action: "accept" });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /Provide at least one field/,
    );
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", users: [] },
        execution(),
      ),
      /non-empty array/,
    );
    // accounts 传 @ALL：允许，body 原样透传。
    const allOut = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", accounts: ["@ALL"] },
      execution(),
    );
    assert.match(allOut, /Command filter updated/);
    const allPatch = calls.filter((c) => c.init.method === "PATCH").at(-1);
    assert.deepEqual(JSON.parse(allPatch.init.body), { accounts: ["@ALL"] });
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", action: "bogus" },
        execution(),
      ),
      /action must be/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_command_filter fails clearly when the filter does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_command_filter");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", action: "accept" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_command_filter checks existence first and reports name/action, and rejects malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "全员禁止",
      action: { value: "reject", label: "拒绝" },
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_command_filter");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Command filter deleted/);
    assert.match(output, /name="全员禁止"/);
    assert.match(output, /action="拒绝"/);

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('approvalReasonForWrite flags action="accept" as a security downgrade for create/update command filter', () => {
  const createReason = internals.approvalReasonForWrite({
    name: "jumpserver_create_command_filter",
    arguments: {
      name: "relaxed",
      action: "accept",
      users: ["u1"],
      assets: ["a1"],
      accounts: ["acc1"],
    },
  });
  assert.match(createReason, /安全提示/);

  const updateAcceptReason = internals.approvalReasonForWrite({
    name: "jumpserver_update_command_filter",
    arguments: { id: "f1", action: "accept" },
  });
  assert.match(updateAcceptReason, /安全降级/);
  assert.match(updateAcceptReason, /停止拦截/);

  const updateWarningReason = internals.approvalReasonForWrite({
    name: "jumpserver_update_command_filter",
    arguments: { id: "f1", action: "warning" },
  });
  assert.match(updateWarningReason, /安全提示/);

  const updateRejectReason = internals.approvalReasonForWrite({
    name: "jumpserver_update_command_filter",
    arguments: { id: "f1", action: "reject" },
  });
  assert.doesNotMatch(updateRejectReason, /安全/);
});

test("approvalReasonForWrite warns about removing active protection when deleting a reject/warning command filter, based on __currentAction", () => {
  const rejectReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_command_filter",
    arguments: { id: "f1", __currentAction: "reject" },
  });
  assert.match(rejectReason, /安全警告/);
  assert.match(rejectReason, /移除命令拦截保护/);

  const warningReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_command_filter",
    arguments: { id: "f1", __currentAction: "warning" },
  });
  assert.match(warningReason, /安全提示/);

  const acceptReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_command_filter",
    arguments: { id: "f1", __currentAction: "accept" },
  });
  assert.doesNotMatch(acceptReason, /安全/);

  const unknownReason = internals.approvalReasonForWrite({
    name: "jumpserver_delete_command_filter",
    arguments: { id: "f1" },
  });
  assert.match(unknownReason, /无法确认/);
});

test("the tools/pre-execute gate fetches the current action before approving a command-filter deletion, and does not block approval if the fetch fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      action: { value: "reject", label: "拒绝" },
    });
  try {
    const { listeners } = createContext();
    const gate = listeners.get("tools/pre-execute");
    const decision = await gate(
      {
        name: "jumpserver_delete_command_filter",
        arguments: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask");
    assert.match(decision.reason, /安全警告/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const { listeners } = createContext();
    const gate = listeners.get("tools/pre-execute");
    const decision = await gate(
      {
        name: "jumpserver_delete_command_filter",
        arguments: { id: "123e4567-e89b-12d3-a456-426614174000" },
      },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask");
    assert.match(decision.reason, /无法确认/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the tools/pre-execute gate also forces command group/filter write tools to "ask", and their reads are untouched', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");

  const writeNames = [
    "jumpserver_create_command_group",
    "jumpserver_update_command_group",
    "jumpserver_delete_command_group",
    "jumpserver_create_command_filter",
    "jumpserver_update_command_filter",
  ];
  for (const name of writeNames) {
    const decision = await gate(
      { name, arguments: { id: "x", name: "x" } },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }

  for (const name of [
    "jumpserver_list_command_groups",
    "jumpserver_get_command_group",
    "jumpserver_list_command_filters",
    "jumpserver_get_command_filter",
  ]) {
    const decision = await gate({ name, arguments: {} }, async () => ({
      kind: "allow",
    }));
    assert.deepEqual(
      decision,
      { kind: "allow" },
      `${name} is read-only and should not require approval`,
    );
  }
});

function createSettingsContext(userSection = {}) {
  const tools = [];
  let section = { ...userSection };
  const registrations = [];
  const ctx = {
    credentials: {
      async resolve(ref) {
        if (ref === "JUMPSERVER_ACCESS_KEY_ID") return { value: "test-ak" };
        if (ref === "JUMPSERVER_ACCESS_KEY_SECRET") return { value: "test-sk" };
        return undefined;
      },
    },
    on() {
      return () => {};
    },
    inject(services, callback) {
      if (!services.includes("settings")) return;
      callback({
        ...ctx,
        effect(setup) {
          setup();
        },
        settings: {
          register(ns, schema, options = {}) {
            const scope = {
              get: () => schema({ ...options.base, ...section }),
              async update(patch) {
                section = { ...section, ...patch };
              },
            };
            options.validate?.(scope.get());
            registrations.push({ ns, options, scope });
            return scope;
          },
        },
      });
    },
    systemPrompt: { section() {} },
    tools: {
      register(tool) {
        tools.push(tool);
        return () => {};
      },
    },
  };
  apply(ctx, {});
  return { registrations, tools };
}

test("apply registers a jumpserver settings namespace and resolves baseUrl through it", async () => {
  const { registrations, tools } = createSettingsContext({
    baseUrl: "https://jumpserver.internal",
  });
  assert.equal(registrations.length, 1);
  const [{ ns, options, scope }] = registrations;
  assert.equal(ns, SETTINGS_NAMESPACE);
  assert.equal(typeof options.validate, "function");
  assert.throws(
    () => options.validate({ ...scope.get(), akRef: "bad ref" }),
    /Invalid AccessKeyID credential reference/,
  );

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ count: 0, results: [] });
  };
  try {
    await toolByName(tools, "jumpserver_list_assets").execute({}, execution());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(new URL(calls[0]).origin, "https://jumpserver.internal");
});

test("Config schema exposes documented defaults", () => {
  // baseUrl / allowInsecureHttp 标了 .volatile()，宿主解析后得到的是 Volatile 引用，
  // 消费前由 unwrapVolatile 拆包；这里按真实消费路径比较。
  const config = unwrapVolatile(Config({}));
  assert.equal(config.baseUrl, "");
  assert.equal(config.akRef, "JUMPSERVER_ACCESS_KEY_ID");
  assert.equal(config.skRef, "JUMPSERVER_ACCESS_KEY_SECRET");
  assert.equal(config.allowInsecureHttp, true);
});

test("isOrgRootKey recognizes numeric-only keys as the organization root, and nested keys as not", () => {
  assert.equal(internals.isOrgRootKey("1"), true);
  assert.equal(internals.isOrgRootKey("42"), true);
  assert.equal(internals.isOrgRootKey("1:3"), false);
  assert.equal(internals.isOrgRootKey("1:3:7"), false);
  assert.equal(internals.isOrgRootKey(""), false);
  assert.equal(internals.isOrgRootKey(undefined), false);
});

test("jumpserver_list_nodes and jumpserver_get_node format results and reject malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (new URL(String(url)).pathname === "/api/v1/assets/nodes/") {
      return jsonResponse({
        count: 2,
        results: [
          {
            id: "n-root",
            key: "1",
            value: "Default",
            full_value: "/Default",
            assets_amount: 5,
          },
          {
            id: "n-child",
            key: "1:3",
            value: "Beijing",
            full_value: "/Default/Beijing",
            assets_amount: 2,
          },
        ],
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      key: "1:3",
      value: "Beijing",
      full_value: "/Default/Beijing",
      parent_key: "1",
      assets_amount: 2,
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_nodes");
    const listOutput = await list.execute({}, execution());
    assert.match(listOutput, /value="Default"/);
    assert.match(listOutput, /is_org_root=true/);
    assert.match(listOutput, /value="Beijing"/);
    assert.match(listOutput, /is_org_root=false/);

    const get = toolByName(tools, "jumpserver_get_node");
    const getOutput = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(getOutput, /full_value="\/Default\/Beijing"/);
    assert.match(getOutput, /parent_key="1"/);
    assert.match(getOutput, /is_org_root=false/);

    await assert.rejects(
      get.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_node supports plain value (root child) or fullValue (nested path)", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      {
        id: "n1",
        key: "1:5",
        value: "Shanghai",
        full_value: "/Default/Shanghai",
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_node");

    const byValue = await create.execute({ value: "Shanghai" }, execution());
    assert.match(byValue, /Node created/);
    assert.deepEqual(JSON.parse(calls[0].init.body), { value: "Shanghai" });

    const byFullValue = await create.execute(
      { fullValue: "Default/East/Shanghai" },
      execution(),
    );
    assert.match(byFullValue, /Node created/);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      full_value: "Default/East/Shanghai",
    });

    await assert.rejects(
      create.execute({}, execution()),
      /Provide either value or fullValue/,
    );
    await assert.rejects(
      create.execute({ value: "a/b" }, execution()),
      /must not contain/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('jumpserver_update_node checks existence first, renames, and rejects "/" in the new value', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET")
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        key: "1:3",
        value: "Beijing",
      });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      key: "1:3",
      value: "Beijing-renamed",
      full_value: "/Default/Beijing-renamed",
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_node");
    const output = await update.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000", value: "Beijing-renamed" },
      execution(),
    );
    assert.match(output, /Node updated/);
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.equal(calls[1].init.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      value: "Beijing-renamed",
    });

    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", value: "a/b" },
        execution(),
      ),
      /must not contain/,
    );
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000" },
        execution(),
      ),
      /missing required property "value"/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_node fails clearly when the node does not exist, without attempting the PATCH", async () => {
  const originalFetch = globalThis.fetch;
  let patchCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "PATCH") {
      patchCount += 1;
      return jsonResponse({}, 200);
    }
    return jsonResponse({ detail: "Not found." }, 404);
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_node");
    await assert.rejects(
      update.execute(
        { id: "123e4567-e89b-12d3-a456-426614174000", value: "x" },
        execution(),
      ),
      /404/,
    );
    assert.equal(patchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_node refuses to delete the organization root node without calling the API", async () => {
  const originalFetch = globalThis.fetch;
  let deleteCount = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if ((init.method ?? "GET") === "DELETE") {
      deleteCount += 1;
      return new Response(null, { status: 204 });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      key: "1",
      value: "Default",
      full_value: "/Default",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_node");
    await assert.rejects(
      del.execute({ id: "123e4567-e89b-12d3-a456-426614174000" }, execution()),
      /Cannot delete the organization root node/,
    );
    assert.equal(deleteCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_node checks existence first and reports the full path for a non-root node", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      key: "1:3",
      value: "Beijing",
      full_value: "/Default/Beijing",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_node");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Node deleted/);
    assert.match(output, /full_value="\/Default\/Beijing"/);
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_move_node validates both ids exist, rejects moving a node under itself, and PATCHes the target parent's children endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/assets/nodes/123e4567-e89b-12d3-a456-426614174000/") {
      return jsonResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        full_value: "/Default/Beijing",
      });
    }
    if (path === "/api/v1/assets/nodes/223e4567-e89b-12d3-a456-426614174000/") {
      return jsonResponse({
        id: "223e4567-e89b-12d3-a456-426614174000",
        full_value: "/Default/East",
      });
    }
    if (
      path ===
      "/api/v1/assets/nodes/223e4567-e89b-12d3-a456-426614174000/children/"
    ) {
      return jsonResponse("OK");
    }
    return jsonResponse({ detail: "unexpected" }, 500);
  };
  try {
    const { tools } = createContext();
    const move = toolByName(tools, "jumpserver_move_node");
    const output = await move.execute(
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        targetParentId: "223e4567-e89b-12d3-a456-426614174000",
      },
      execution(),
    );
    assert.match(output, /Node moved/);
    assert.match(output, /\/Default\/Beijing/);
    assert.match(output, /\/Default\/East/);

    const childrenCall = calls.find((c) => c.url.endsWith("/children/"));
    assert.ok(childrenCall, "expected a call to the children endpoint");
    assert.equal(childrenCall.init.method, "PATCH");
    assert.deepEqual(JSON.parse(childrenCall.init.body), {
      nodes: ["123e4567-e89b-12d3-a456-426614174000"],
    });

    await assert.rejects(
      move.execute(
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          targetParentId: "123e4567-e89b-12d3-a456-426614174000",
        },
        execution(),
      ),
      /must be different nodes/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_move_node surfaces the JumpServer cycle-rejection error unchanged", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if ((init.method ?? "GET") === "GET")
      return jsonResponse({ id: "x", full_value: "/x" });
    if (path.endsWith("/children/"))
      return jsonResponse(
        {
          error:
            "Node Beijing is an ancestor of node East, can't be added as its child",
        },
        400,
      );
    return jsonResponse({ detail: "unexpected" }, 500);
  };
  try {
    const { tools } = createContext();
    const move = toolByName(tools, "jumpserver_move_node");
    await assert.rejects(
      move.execute(
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          targetParentId: "223e4567-e89b-12d3-a456-426614174000",
        },
        execution(),
      ),
      /ancestor of node East/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the tools/pre-execute gate also forces node write tools to "ask", and node reads are untouched', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");

  for (const name of [
    "jumpserver_create_node",
    "jumpserver_update_node",
    "jumpserver_delete_node",
    "jumpserver_move_node",
  ]) {
    const decision = await gate(
      { name, arguments: { id: "x", value: "x", targetParentId: "y" } },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }

  for (const name of ["jumpserver_list_nodes", "jumpserver_get_node"]) {
    const decision = await gate({ name, arguments: {} }, async () => ({
      kind: "allow",
    }));
    assert.deepEqual(
      decision,
      { kind: "allow" },
      `${name} is read-only and should not require approval`,
    );
  }
});

test("approvalReasonForWrite describes node create/update/delete/move, flagging fullValue path creation", () => {
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_create_node",
      arguments: { value: "Beijing" },
    }),
    /创建新的 JumpServer 资产树节点：value="Beijing"，作为组织根节点的直接子节点/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_create_node",
      arguments: { fullValue: "Default/East/Beijing" },
    }),
    /fullValue="Default\/East\/Beijing".*中间节点/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_update_node",
      arguments: { id: "n1", value: "Renamed" },
    }),
    /将 JumpServer 资产树节点 id=n1 重命名为 value="Renamed"/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_delete_node",
      arguments: { id: "n1" },
    }),
    /永久删除 JumpServer 资产树节点 id=n1/,
  );
  assert.match(
    internals.approvalReasonForWrite({
      name: "jumpserver_move_node",
      arguments: { id: "n1", targetParentId: "n2" },
    }),
    /移动 JumpServer 资产树节点 id=n1.*使其成为节点 id=n2 的子节点/,
  );
});

test("jumpserver_list_roles and jumpserver_get_role format results, validate scope, and reject malformed ids", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (new URL(String(url)).pathname === "/api/v1/rbac/roles/") {
      return jsonResponse({
        count: 1,
        results: [
          {
            id: "r1",
            name: "OrgAdmin",
            scope: { value: "org", label: "Organization" },
            builtin: true,
            users_amount: 3,
            permissions_amount: 42,
          },
        ],
      });
    }
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Auditor",
      scope: { value: "org", label: "Organization" },
      builtin: false,
      comment: "custom role",
      permissions: ["p1", "p2"],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_roles");
    const listOutput = await list.execute({ scope: "org" }, execution());
    assert.match(listOutput, /name="OrgAdmin"/);
    assert.match(listOutput, /builtin=true/);
    assert.match(new URL(calls[0]).search, /scope=org/);

    await assert.rejects(
      list.execute({ scope: "bogus" }, execution()),
      /"scope" must be one of/,
    );

    const get = toolByName(tools, "jumpserver_get_role");
    const getOutput = await get.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(getOutput, /name="Auditor"/);
    assert.match(getOutput, /permissions="p1,p2"/);

    await assert.rejects(
      get.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_role requires name/scope, validates scope enum, and posts permissionIds as permissions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return jsonResponse(
      { id: "r1", name: "Auditor", scope: { value: "org" } },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_role");
    const output = await create.execute(
      {
        name: "Auditor",
        scope: "org",
        permissionIds: ["123e4567-e89b-12d3-a456-426614174000"],
        comment: "read-only audit role",
      },
      execution(),
    );
    assert.match(output, /Role created/);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      name: "Auditor",
      scope: "org",
      permissions: ["123e4567-e89b-12d3-a456-426614174000"],
      comment: "read-only audit role",
    });

    await assert.rejects(
      create.execute({ scope: "org" }, execution()),
      /missing required property "name"/,
    );
    await assert.rejects(
      create.execute({ name: "X" }, execution()),
      /missing required property "scope"/,
    );
    await assert.rejects(
      create.execute({ name: "X", scope: "bogus" }, execution()),
      /"scope" must be one of/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_update_role refuses to update a builtin role, and PATCHes only provided fields for a custom role", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const builtinId = "323e4567-e89b-12d3-a456-426614174000";
  const customId = "123e4567-e89b-12d3-a456-426614174000";
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET") {
      if (String(url).includes(builtinId))
        return jsonResponse({
          id: builtinId,
          name: "SystemAdmin",
          builtin: true,
        });
      return jsonResponse({ id: customId, name: "Auditor", builtin: false });
    }
    return jsonResponse({
      id: customId,
      name: "Auditor-renamed",
      scope: { value: "org" },
    });
  };
  try {
    const { tools } = createContext();
    const update = toolByName(tools, "jumpserver_update_role");

    await assert.rejects(
      update.execute({ id: builtinId, name: "x" }, execution()),
      /builtin role and cannot be updated/,
    );

    const output = await update.execute(
      { id: customId, name: "Auditor-renamed" },
      execution(),
    );
    assert.match(output, /Role updated/);
    const patchCall = calls.find((c) => c.init.method === "PATCH");
    assert.deepEqual(JSON.parse(patchCall.init.body), {
      name: "Auditor-renamed",
    });

    await assert.rejects(
      update.execute({ id: customId }, execution()),
      /Provide at least one field/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_role refuses to delete a builtin role, checks existence first, and reports name/scope", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const builtinId = "323e4567-e89b-12d3-a456-426614174000";
  const customId = "123e4567-e89b-12d3-a456-426614174000";
  let deleteCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE") {
      deleteCount += 1;
      return new Response(null, { status: 204 });
    }
    if (String(url).includes(builtinId))
      return jsonResponse({
        id: builtinId,
        name: "SystemAdmin",
        builtin: true,
        scope: { value: "system" },
      });
    return jsonResponse({
      id: customId,
      name: "Auditor",
      builtin: false,
      scope: { value: "org" },
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_role");

    await assert.rejects(
      del.execute({ id: builtinId }, execution()),
      /builtin role and cannot be deleted/,
    );
    assert.equal(deleteCount, 0);

    const output = await del.execute({ id: customId }, execution());
    assert.match(output, /Role deleted/);
    assert.match(output, /name="Auditor"/);
    assert.equal(deleteCount, 1);

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_list_role_bindings filters by userId/roleId and formats results", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      count: 1,
      results: [
        {
          id: "b1",
          user: "u1",
          user_display: "alice",
          role: "r1",
          role_display: "Auditor",
          scope: { value: "org" },
          org: "o1",
          org_name: "Acme",
        },
      ],
    });
  };
  try {
    const { tools } = createContext();
    const list = toolByName(tools, "jumpserver_list_role_bindings");
    const output = await list.execute(
      {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        roleId: "223e4567-e89b-12d3-a456-426614174000",
      },
      execution(),
    );
    assert.match(output, /user_display="alice"/);
    assert.match(output, /role_display="Auditor"/);
    const search = new URL(calls[0]).search;
    assert.match(search, /user=123e4567-e89b-12d3-a456-426614174000/);
    assert.match(search, /role=223e4567-e89b-12d3-a456-426614174000/);

    await assert.rejects(
      list.execute({ userId: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_create_role_binding requires orgId for org-scope roles and rejects it for system-scope roles", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const orgRoleId = "323e4567-e89b-12d3-a456-426614174000";
  const sysRoleId = "423e4567-e89b-12d3-a456-426614174000";
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "GET") {
      if (String(url).includes(orgRoleId))
        return jsonResponse({
          id: orgRoleId,
          name: "Auditor",
          scope: { value: "org" },
        });
      return jsonResponse({
        id: sysRoleId,
        name: "SystemAdmin",
        scope: { value: "system" },
      });
    }
    return jsonResponse(
      {
        id: "b1",
        user: "u1",
        role: orgRoleId,
        scope: { value: "org" },
        org: "o1",
      },
      201,
    );
  };
  try {
    const { tools } = createContext();
    const create = toolByName(tools, "jumpserver_create_role_binding");

    await assert.rejects(
      create.execute(
        { userId: "123e4567-e89b-12d3-a456-426614174000", roleId: orgRoleId },
        execution(),
      ),
      /is an org-scope role; orgId is required/,
    );

    const output = await create.execute(
      {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        roleId: orgRoleId,
        orgId: "223e4567-e89b-12d3-a456-426614174000",
      },
      execution(),
    );
    assert.match(output, /Role binding created/);
    const postCall = calls.find((c) => c.init.method === "POST");
    assert.deepEqual(JSON.parse(postCall.init.body), {
      user: "123e4567-e89b-12d3-a456-426614174000",
      role: orgRoleId,
      org: "223e4567-e89b-12d3-a456-426614174000",
    });

    await assert.rejects(
      create.execute(
        {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          roleId: sysRoleId,
          orgId: "223e4567-e89b-12d3-a456-426614174000",
        },
        execution(),
      ),
      /is a system-scope role; orgId must be omitted/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jumpserver_delete_role_binding checks existence first and reports user/role display names", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if ((init.method ?? "GET") === "DELETE")
      return new Response(null, { status: 204 });
    return jsonResponse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      user_display: "alice",
      role_display: "Auditor",
    });
  };
  try {
    const { tools } = createContext();
    const del = toolByName(tools, "jumpserver_delete_role_binding");
    const output = await del.execute(
      { id: "123e4567-e89b-12d3-a456-426614174000" },
      execution(),
    );
    assert.match(output, /Role binding deleted/);
    assert.match(output, /user="alice"/);
    assert.match(output, /role="Auditor"/);
    assert.equal(calls[1].init.method, "DELETE");

    await assert.rejects(
      del.execute({ id: "not-a-uuid" }, execution()),
      /valid JumpServer UUID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the tools/pre-execute gate also forces role and role-binding write tools to "ask", and their reads are untouched', async () => {
  const { listeners } = createContext();
  const gate = listeners.get("tools/pre-execute");

  for (const name of [
    "jumpserver_create_role",
    "jumpserver_update_role",
    "jumpserver_delete_role",
    "jumpserver_create_role_binding",
    "jumpserver_delete_role_binding",
  ]) {
    const decision = await gate(
      {
        name,
        arguments: {
          id: "x",
          name: "x",
          scope: "org",
          userId: "u",
          roleId: "r",
        },
      },
      async () => ({ kind: "allow" }),
    );
    assert.equal(decision.kind, "ask", `${name} should require approval`);
  }

  for (const name of [
    "jumpserver_list_roles",
    "jumpserver_get_role",
    "jumpserver_list_role_bindings",
  ]) {
    const decision = await gate({ name, arguments: {} }, async () => ({
      kind: "allow",
    }));
    assert.deepEqual(
      decision,
      { kind: "allow" },
      `${name} is read-only and should not require approval`,
    );
  }
});

test("approvalReasonForWrite flags system-scope role creation/binding as high risk", () => {
  const systemCreate = internals.approvalReasonForWrite({
    name: "jumpserver_create_role",
    arguments: { name: "SuperRole", scope: "system", permissionIds: ["p1"] },
  });
  assert.match(systemCreate, /高风险/);
  const orgCreate = internals.approvalReasonForWrite({
    name: "jumpserver_create_role",
    arguments: { name: "OrgRole", scope: "org", permissionIds: [] },
  });
  assert.doesNotMatch(orgCreate, /高风险/);

  const binding = internals.approvalReasonForWrite({
    name: "jumpserver_create_role_binding",
    arguments: { userId: "u1", roleId: "r1" },
  });
  assert.match(binding, /高风险/);
  assert.match(binding, /组织：none（system 作用域）/);

  const del = internals.approvalReasonForWrite({
    name: "jumpserver_delete_role",
    arguments: { id: "r1" },
  });
  assert.match(del, /永久删除 JumpServer RBAC 角色 id=r1/);
});
