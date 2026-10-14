import assert from "node:assert/strict";
import test from "node:test";

import {
  akRefForId,
  apply,
  internals,
  normalizeSourceName,
  skRefForId,
} from "../index.js";

const LEGACY_AK = "JUMPSERVER_ACCESS_KEY_ID";
const LEGACY_SK = "JUMPSERVER_ACCESS_KEY_SECRET";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toolByName(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

const execution = () => ({ signal: new AbortController().signal });

// 用 fetch 间谍记录每次请求的目标地址与签名所用的 keyId。
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const authorization = init?.headers?.Authorization ?? "";
    calls.push({
      url: String(url),
      keyId: /keyId="([^"]*)"/.exec(authorization)?.[1],
      method: init?.method,
    });
    return handler ? handler(url, init) : jsonResponse({ count: 0, results: [] });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

// 模拟 0.2.0 宿主：settings 服务只有 describe/update/mutate，没有 register。
// state.value 是宿主解析后的实时配置，update 做浅合并并推进 revision。
function createHost({
  value = {},
  creds = {},
  failUpdate = null,
  hasRegister = false,
  emptyDescribes = 0,
} = {}) {
  const tools = [];
  const listeners = new Map();
  const updates = [];
  const state = { value: { ...value }, revision: 1 };
  const credState = { ...creds };
  // 真实宿主的 describe() 只返回已进入运行态的条目：前 emptyDescribes 次返回空，
  // 用来模拟插件在 apply 同步阶段还没被登记为可配置条目。
  let remainingEmpty = emptyDescribes;
  const settings = {
    describe: () => {
      if (remainingEmpty > 0) {
        remainingEmpty -= 1;
        return [];
      }
      return [
        {
          ns: "jumpserver",
          value: { ...state.value },
          revision: state.revision,
        },
      ];
    },
    async update(ns, patch, revision) {
      updates.push({ ns, patch, revision });
      if (failUpdate) throw new Error(failUpdate);
      state.value = { ...state.value, ...patch };
      state.revision += 1;
    },
  };
  if (hasRegister) {
    settings.register = (_ns, schema, options = {}) => ({
      get: () => schema({ ...options.base, ...state.value }),
    });
  }
  const ctx = {
    credentials: {
      async resolve(ref) {
        return credState[ref] ? { value: credState[ref] } : undefined;
      },
    },
    inject(services, callback) {
      if (!services.includes("settings")) return;
      callback({
        ...ctx,
        effect(setup) {
          setup();
        },
        settings,
      });
    },
    on(name, listener) {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
    systemPrompt: { section() {} },
    tools: {
      register(tool) {
        tools.push(tool);
        return () => {};
      },
    },
  };
  return { ctx, tools, listeners, state, updates, credState };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const TWO_SOURCES = {
  sources: [
    { id: "id-prod", name: "prod", baseUrl: "https://prod.example.com", akRef: "AK_PROD", skRef: "SK_PROD" },
    { id: "id-stg", name: "staging", baseUrl: "https://staging.example.com", akRef: "AK_STG", skRef: "SK_STG" },
  ],
  defaultSource: "id-prod",
};
const TWO_CREDS = { AK_PROD: "ak-prod", SK_PROD: "sk-prod", AK_STG: "ak-stg", SK_STG: "sk-stg" };

function startTwoSources(extra = {}) {
  const host = createHost({ value: { ...TWO_SOURCES, ...extra }, creds: TWO_CREDS });
  apply(host.ctx, {});
  return host;
}

// ── 源站选择与隔离 ───────────────────────────────────────────────────

test("each source is routed to its own URL and signed with its own AccessKey", async () => {
  const { tools } = startTwoSources();
  const list = toolByName(tools, "jumpserver_list_assets");
  await withFetch(null, async (calls) => {
    await list.execute({ source: "prod" }, execution());
    await list.execute({ source: "staging" }, execution());
    assert.equal(new URL(calls[0].url).origin, "https://prod.example.com");
    assert.equal(calls[0].keyId, "ak-prod");
    assert.equal(new URL(calls[1].url).origin, "https://staging.example.com");
    assert.equal(calls[1].keyId, "ak-stg");
  });
});

test("omitting source uses the configured default; a source can be selected by id too", async () => {
  const { tools } = startTwoSources({ defaultSource: "id-stg" });
  const list = toolByName(tools, "jumpserver_list_assets");
  await withFetch(null, async (calls) => {
    await list.execute({}, execution());
    await list.execute({ source: "id-prod" }, execution());
    assert.equal(new URL(calls[0].url).origin, "https://staging.example.com");
    assert.equal(new URL(calls[1].url).origin, "https://prod.example.com");
  });
});

test("concurrent calls to different sources never cross credentials or URLs", async () => {
  const { tools } = startTwoSources();
  const list = toolByName(tools, "jumpserver_list_assets");
  await withFetch(
    async (url) => {
      // prod 故意更慢，使两次调用在时间上交错。
      await new Promise((r) => setTimeout(r, String(url).includes("prod") ? 25 : 1));
      return jsonResponse({ count: 0, results: [] });
    },
    async (calls) => {
      await Promise.all([
        list.execute({ source: "prod" }, execution()),
        list.execute({ source: "staging" }, execution()),
        list.execute({ source: "prod" }, execution()),
      ]);
      for (const call of calls) {
        const host = new URL(call.url).host;
        assert.equal(call.keyId, host.startsWith("prod") ? "ak-prod" : "ak-stg", `crossed: ${host} signed by ${call.keyId}`);
      }
      assert.equal(calls.length, 3);
    },
  );
});

test("an unknown source fails fast and names the configured ones", async () => {
  const { tools } = startTwoSources();
  await withFetch(null, async (calls) => {
    await assert.rejects(
      toolByName(tools, "jumpserver_list_assets").execute({ source: "nope" }, execution()),
      /Unknown JumpServer source "nope".*"prod".*"staging".*jumpserver_sources/,
    );
    assert.equal(calls.length, 0, "no request may be sent for an unknown source");
  });
});

test("several sources and no default: omitting source is an error, not a guess", async () => {
  const { tools } = startTwoSources({ defaultSource: "" });
  await withFetch(null, async (calls) => {
    await assert.rejects(
      toolByName(tools, "jumpserver_list_assets").execute({}, execution()),
      /Multiple JumpServer sources are configured/,
    );
    assert.equal(calls.length, 0);
  });
});

test("a source without credentials reports which source is missing them", async () => {
  const host = createHost({ value: TWO_SOURCES, creds: { AK_PROD: "a", SK_PROD: "s" } });
  apply(host.ctx, {});
  await withFetch(null, async () => {
    await assert.rejects(
      toolByName(host.tools, "jumpserver_list_assets").execute({ source: "staging" }, execution()),
      /AK_STG \(AccessKeyID\) is not configured for source "staging"/,
    );
  });
});

test("every tool except jumpserver_sources accepts an optional source argument", () => {
  const { tools } = startTwoSources();
  assert.equal(tools.length, 54);
  for (const tool of tools) {
    const has = Boolean(tool.parameters?.properties?.source);
    assert.equal(has, tool.name !== "jumpserver_sources", tool.name);
    if (has) assert.ok(!(tool.parameters.required ?? []).includes("source"), `${tool.name}: source must be optional`);
  }
});

// ── jumpserver_sources ──────────────────────────────────────────────

test("jumpserver_sources lists sources with configured flags and never returns credentials", async () => {
  const { tools } = createHostAndStart({ AK_PROD: "ak-prod-SECRET", SK_PROD: "sk-prod-SECRET" });
  const out = await toolByName(tools, "jumpserver_sources").execute({}, execution());
  assert.match(out, /name="prod".*accessKeyConfigured=true secretKeyConfigured=true default=true/);
  assert.match(out, /name="staging".*accessKeyConfigured=false secretKeyConfigured=false default=false/);
  assert.doesNotMatch(out, /SECRET|ak-prod|sk-prod/);

  function createHostAndStart(creds) {
    const host = createHost({ value: TWO_SOURCES, creds });
    apply(host.ctx, {});
    return host;
  }
});

// ── 审批绑定 ────────────────────────────────────────────────────────

const allow = async () => ({ kind: "allow" });

test("with several sources the approval prompt names the target source", async () => {
  const { listeners } = startTwoSources();
  const gate = listeners.get("tools/pre-execute");
  const decision = await gate(
    { name: "jumpserver_delete_asset", arguments: { id: "11111111-1111-1111-1111-111111111111", source: "staging" } },
    allow,
  );
  assert.equal(decision.kind, "ask");
  assert.match(decision.reason, /^JumpServer 源站「staging」：/);
});

test("with a single source the approval prompt stays unchanged (no source prefix)", async () => {
  const host = createHost({
    value: { sources: [TWO_SOURCES.sources[0]], defaultSource: "id-prod" },
    creds: TWO_CREDS,
  });
  apply(host.ctx, {});
  const decision = await host.listeners.get("tools/pre-execute")(
    { name: "jumpserver_delete_asset", arguments: { id: "11111111-1111-1111-1111-111111111111" } },
    allow,
  );
  assert.equal(decision.kind, "ask");
  assert.doesNotMatch(decision.reason, /JumpServer 源站/);
});

test("a write aimed at an unknown source is denied at approval time, not after the user clicks yes", async () => {
  const { listeners } = startTwoSources();
  const decision = await listeners.get("tools/pre-execute")(
    { name: "jumpserver_delete_asset", arguments: { id: "11111111-1111-1111-1111-111111111111", source: "typo" } },
    allow,
  );
  assert.equal(decision.kind, "deny");
  assert.match(decision.reason, /Unknown JumpServer source "typo"/);
});

test("a write approved for one source is refused if the default changes before it runs", async () => {
  const host = startTwoSources();
  const exec = {
    name: "jumpserver_delete_asset",
    arguments: { id: "11111111-1111-1111-1111-111111111111" },
    signal: new AbortController().signal,
  };
  // 审批时省略 source → 解析到默认源站 prod。
  const decision = await host.listeners.get("tools/pre-execute")(exec, allow);
  assert.match(decision.reason, /「prod」/);
  // 审批之后、执行之前，另一个设置页把默认源站改成了 staging。
  host.state.value = { ...host.state.value, defaultSource: "id-stg" };
  await withFetch(null, async (calls) => {
    await assert.rejects(
      toolByName(host.tools, "jumpserver_delete_asset").execute(exec.arguments, exec),
      /approved for has changed.*"prod".*"staging".*Nothing was written/,
    );
    assert.equal(calls.length, 0, "the write must not reach any JumpServer");
  });
});

test("the same approved write still runs when the source is unchanged", async () => {
  const host = startTwoSources();
  const exec = {
    name: "jumpserver_delete_asset",
    arguments: { id: "11111111-1111-1111-1111-111111111111", source: "staging" },
    signal: new AbortController().signal,
  };
  await host.listeners.get("tools/pre-execute")(exec, allow);
  await withFetch(
    async (_url, init) =>
      init.method === "GET"
        ? jsonResponse({ id: "x", name: "n" })
        : new Response(null, { status: 204 }),
    async (calls) => {
      await toolByName(host.tools, "jumpserver_delete_asset").execute(exec.arguments, exec);
      assert.ok(calls.length > 0);
      for (const call of calls) assert.equal(new URL(call.url).origin, "https://staging.example.com");
    },
  );
});

test("the delete-command-filter pre-lookup is sent to the targeted source", async () => {
  const { listeners } = startTwoSources();
  await withFetch(
    async () => jsonResponse({ action: { value: "reject" } }),
    async (calls) => {
      await listeners.get("tools/pre-execute")(
        { name: "jumpserver_delete_command_filter", arguments: { id: "11111111-1111-1111-1111-111111111111", source: "staging" } },
        allow,
      );
      assert.equal(calls.length, 1);
      assert.equal(new URL(calls[0].url).origin, "https://staging.example.com");
      assert.equal(calls[0].keyId, "ak-stg");
    },
  );
});

// ── 旧配置迁移 ──────────────────────────────────────────────────────

// 迁移里故意制造的失败会写 stderr；这些用例只关心行为，不要污染测试输出。
async function quietly(run) {
  const original = console.error;
  const logged = [];
  console.error = (line) => logged.push(String(line));
  try {
    return await run(logged);
  } finally {
    console.error = original;
  }
}

test("a legacy single-source setup keeps working before any migration happens", async () => {
  const host = createHost({
    value: { baseUrl: "https://legacy.example.com" },
    creds: { [LEGACY_AK]: "legacy-ak", [LEGACY_SK]: "legacy-sk" },
    failUpdate: "boom",
  });
  await quietly(async () => {
    apply(host.ctx, {});
    await tick();
  });
  await withFetch(null, async (calls) => {
    await toolByName(host.tools, "jumpserver_list_assets").execute({}, execution());
    assert.equal(new URL(calls[0].url).origin, "https://legacy.example.com");
    assert.equal(calls[0].keyId, "legacy-ak");
  });
});

test("startup migration turns the legacy URL + credentials into one default source, reusing the old refs", async () => {
  const host = createHost({
    value: { baseUrl: "https://legacy.example.com" },
    creds: { [LEGACY_AK]: "legacy-ak", [LEGACY_SK]: "legacy-sk" },
  });
  apply(host.ctx, {});
  await tick();
  assert.equal(host.updates.length, 1);
  const { patch, revision } = host.updates[0];
  assert.equal(revision, 1, "must pass the revision it read, so a concurrent save wins");
  assert.equal(patch.sources.length, 1);
  const [source] = patch.sources;
  assert.equal(source.name, "default");
  assert.equal(source.baseUrl, "https://legacy.example.com");
  assert.equal(source.akRef, LEGACY_AK, "old credential refs are reused — no secret is moved");
  assert.equal(source.skRef, LEGACY_SK);
  assert.equal(patch.defaultSource, source.id);
  // 迁移后工具仍用同一组凭证访问同一地址。
  await withFetch(null, async (calls) => {
    await toolByName(host.tools, "jumpserver_list_assets").execute({}, execution());
    assert.equal(new URL(calls[0].url).origin, "https://legacy.example.com");
    assert.equal(calls[0].keyId, "legacy-ak");
  });
});

test("migration also covers a credentials-only legacy setup (URL not set yet)", async () => {
  const host = createHost({ creds: { [LEGACY_AK]: "a", [LEGACY_SK]: "s" } });
  apply(host.ctx, {});
  await tick();
  assert.equal(host.updates.length, 1);
  assert.equal(host.updates[0].patch.sources[0].baseUrl, "");
});

test("migration honours custom legacy credential refs", async () => {
  const host = createHost({
    value: { baseUrl: "https://legacy.example.com", akRef: "MY_AK", skRef: "MY_SK" },
    creds: { MY_AK: "a", MY_SK: "s" },
  });
  apply(host.ctx, {});
  await tick();
  assert.equal(host.updates[0].patch.sources[0].akRef, "MY_AK");
  assert.equal(host.updates[0].patch.sources[0].skRef, "MY_SK");
});

test("migration does nothing when sources already exist, or when there is nothing to migrate", async () => {
  const configured = startTwoSources();
  await tick();
  assert.equal(configured.updates.length, 0);

  const empty = createHost({});
  apply(empty.ctx, {});
  await tick();
  assert.equal(empty.updates.length, 0);
});

test("a rejected migration write (e.g. revision conflict) never breaks plugin start-up", async () => {
  const host = createHost({
    value: { baseUrl: "https://legacy.example.com" },
    creds: { [LEGACY_AK]: "a", [LEGACY_SK]: "s" },
    failUpdate: "settings revision changed since read",
  });
  const logged = await quietly(async (lines) => {
    apply(host.ctx, {});
    await tick();
    return lines;
  });
  assert.equal(host.tools.length, 54);
  assert.ok(logged.some((line) => /\[jumpserver-migrate\] sources failed reason=revision-conflict/.test(line)));
  // 日志只含归类原因，不含 URL / 凭证引用。
  assert.ok(logged.every((line) => !/legacy\.example\.com|JUMPSERVER_ACCESS/.test(line)));
});

test("migration waits until the host has registered the plugin instead of misreading an empty describe", async () => {
  // 前两次 describe 返回空：此时若直接判定“没有旧配置”或写入，会误判或报 no longer configurable。
  const host = createHost({
    value: { baseUrl: "https://legacy.example.com" },
    creds: { [LEGACY_AK]: "a", [LEGACY_SK]: "s" },
    emptyDescribes: 2,
  });
  apply(host.ctx, {});
  await tick();
  assert.equal(host.updates.length, 0, "nothing may be written while the descriptor is missing");
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(host.updates.length, 1, "the migration runs once the descriptor appears");
  assert.equal(host.updates[0].patch.sources[0].baseUrl, "https://legacy.example.com");
  assert.equal(host.updates[0].patch.legacyMigrated, true);
  assert.equal(host.updates[0].patch.baseUrl, "");
});

test("once migrated, removing every source does not resurrect an implicit legacy source", async () => {
  const host = createHost({
    value: { legacyMigrated: true, sources: [], baseUrl: "", defaultSource: "" },
    creds: { [LEGACY_AK]: "a", [LEGACY_SK]: "s" },
  });
  apply(host.ctx, {});
  await tick();
  assert.equal(host.updates.length, 0, "a migrated configuration is never migrated again");
  await withFetch(null, async (calls) => {
    await assert.rejects(
      toolByName(host.tools, "jumpserver_list_assets").execute({}, execution()),
      /No JumpServer source is configured/,
    );
    assert.equal(calls.length, 0);
  });
  assert.equal(
    await toolByName(host.tools, "jumpserver_sources").execute({}, execution()),
    "(no JumpServer sources configured)",
  );
});

test("an older host that still offers settings.register keeps working", async () => {
  const host = createHost({
    value: { sources: [TWO_SOURCES.sources[0]], defaultSource: "id-prod" },
    creds: TWO_CREDS,
    hasRegister: true,
  });
  apply(host.ctx, {});
  await withFetch(null, async (calls) => {
    await toolByName(host.tools, "jumpserver_list_assets").execute({}, execution());
    assert.equal(new URL(calls[0].url).origin, "https://prod.example.com");
  });
});

// ── 纯函数 ──────────────────────────────────────────────────────────

test("credential refs derived from a source id are stable, valid and distinct per id", () => {
  const id = "4d0e1971-52f8-48a5-867c-e5506fc2cf73";
  assert.equal(akRefForId(id), "JUMPSERVER_AK_4d0e197152f848a5867ce5506fc2cf73");
  assert.equal(skRefForId(id), "JUMPSERVER_SK_4d0e197152f848a5867ce5506fc2cf73");
  assert.equal(akRefForId(id), akRefForId(id));
  assert.notEqual(akRefForId(id), akRefForId("another-id"));
  assert.notEqual(akRefForId(id), skRefForId(id));
  assert.match(akRefForId(id), /^[A-Za-z_][A-Za-z0-9_]*$/);
});

test("normalizeSourceName trims, and rejects empty or over-long names", () => {
  assert.equal(normalizeSourceName("  生产  "), "生产");
  assert.throws(() => normalizeSourceName("   "), /non-empty/);
  assert.throws(() => normalizeSourceName("x".repeat(101)), /must not exceed 100/);
});

test("config validation rejects duplicate names, duplicate ids, bad refs and dangling defaults", () => {
  const { validateConfigValue } = internals;
  const base = { akRef: LEGACY_AK, skRef: LEGACY_SK };
  const ok = (sources, defaultSource = "") => validateConfigValue({ ...base, sources, defaultSource });
  ok([{ id: "a", name: "one" }, { id: "b", name: "two" }], "b");
  assert.throws(() => ok([{ id: "a", name: "x" }, { id: "b", name: "x" }]), /Duplicate JumpServer source name/);
  assert.throws(() => ok([{ id: "a", name: "x" }, { id: "a", name: "y" }]), /Duplicate JumpServer source id/);
  assert.throws(() => ok([{ id: "a", name: "x", akRef: "bad ref" }]), /Invalid AccessKeyID credential reference/);
  assert.throws(() => ok([{ id: "a", name: "x" }], "zzz"), /does not match any configured/);
  assert.throws(() => ok([{ id: "", name: "x" }]), /Invalid JumpServer source id/);
  assert.throws(() => ok([{ id: "a", name: "" }]), /non-empty name/);
  assert.throws(() => ok([{ id: "a", name: "x", baseUrl: "ftp://nope" }]), /must use https:\/\/ or http:\/\//);
  assert.throws(
    () => ok(Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, name: `n${i}` }))),
    /At most 50/,
  );
});
