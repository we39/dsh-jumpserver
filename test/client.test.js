import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { Config, unwrapVolatile } from "../index.js";

// 在 vm 沙箱里加载浏览器 bundle，返回 { definition, runtime }。
function loadBrowserModule() {
  let definition;
  const window = {
    __ModuleLoader__: { load(value) { definition = value; } },
    confirm: () => true,
  };
  vm.runInNewContext(
    readFileSync(new URL("../client.js", import.meta.url), "utf8"),
    { URL, window, queueMicrotask },
  );
  const runtime = definition.factory((id) => {
    if (id === "react/jsx-runtime") {
      const node = (type, props) => ({ type, props });
      return { jsx: node, jsxs: node };
    }
    if (id === "react") return { createElement: (type, props) => ({ type, props }) };
    throw new Error(`Unexpected browser dependency: ${id}`);
  });
  return { definition, runtime };
}

// 模拟宿主的槽位系统：declared 里有的槽位 inject 时立刻触发回调；
// 之后 declare()/undeclare() 可以模拟迟到声明与撤销。
function buildCtx({ declared = {}, withSpec = true, remote = {} } = {}) {
  const specs = new Map(Object.entries(declared));
  const waiting = new Map();
  const live = new Map();
  const registered = [];
  const slots = {
    inject(name, callback) {
      const entry = { callback, cleanup: undefined };
      waiting.set(name, [...(waiting.get(name) ?? []), entry]);
      if (specs.has(name)) entry.cleanup = callback();
      return () => {
        entry.cleanup?.();
        entry.cleanup = undefined;
        waiting.set(name, (waiting.get(name) ?? []).filter((item) => item !== entry));
      };
    },
    register(options, component) {
      const row = { options, component };
      registered.push(row);
      live.set(row, true);
      return () => live.delete(row);
    },
  };
  if (withSpec) slots.spec = (name) => specs.get(name);
  const ctx = {
    slots,
    effect(fn) { return fn(); },
    get(name) { return name.startsWith("remote.") ? remote[name.slice(7)] : undefined; },
  };
  return {
    ctx,
    registered,
    liveNames: () => [...live.keys()].map((row) => row.options.name),
    declare(name, spec) {
      specs.set(name, spec);
      for (const entry of waiting.get(name) ?? []) entry.cleanup = entry.callback();
    },
    undeclare(name) {
      specs.delete(name);
      for (const entry of waiting.get(name) ?? []) { entry.cleanup?.(); entry.cleanup = undefined; }
    },
  };
}

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

const SECTION = { kind: "list", scope: "root" };
const TAB = { kind: "list", scope: "root" };
const ITEM = { kind: "keyed" };

test("client inject only needs slots, so a missing remote service cannot park the plugin", () => {
  const { runtime } = loadBrowserModule();
  assert.equal(JSON.stringify(runtime.inject), JSON.stringify(["slots"]));
});

test("0.2.0 host: registers the standalone settings.section entry only", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.section": SECTION, "settings.plugins.tab": TAB } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.section"]));
  const row = host.registered[0];
  assert.equal(row.options.id, "jumpserver");
  assert.equal(row.options.label, "JumpServer");
  // 独立分区下卡片默认展开。
  assert.equal(row.component().props.defaultOpen, true);
});

test("0.1.7 host: falls back to the settings.plugins.tab entry", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.plugins.tab": TAB } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugins.tab"]));
  assert.equal(host.registered[0].options.id, "jumpserver");
});

test("legacy host that only declares the keyed settings.plugin.item slot still gets the card", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.plugin.item": ITEM } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugin.item"]));
  assert.equal(host.registered[0].options.key, "jumpserver");
});

test("slot kind mismatch is not treated as an available entry", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.section": { kind: "keyed" } } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(host.liveNames().length, 0);
});

test("a late settings.section declaration replaces the tab entry without duplicating", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.plugins.tab": TAB } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugins.tab"]));
  host.declare("settings.section", SECTION);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.section"]));
  host.undeclare("settings.section");
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugins.tab"]));
});

test("host without slots.spec keeps the legacy dual registration", () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({
    withSpec: false,
    declared: { "settings.plugins.tab": TAB, "settings.plugin.item": ITEM },
  });
  runtime.apply(host.ctx);
  assert.equal(
    JSON.stringify(host.liveNames().sort()),
    JSON.stringify(["settings.plugin.item", "settings.plugins.tab"]),
  );
});

// 记录实传参数个数：网关按声明个数校验，漏传第三参会在真机报错。
function remoteMock({ creds = {}, baseUrl = "", fail = {} } = {}) {
  const calls = [];
  const state = { creds: { ...creds }, baseUrl };
  const result = (what, value) => (fail[what] ? { ok: false, error: { message: fail[what] } } : { ok: true, value });
  return {
    calls,
    state,
    credentials: {
      async describe(...args) {
        calls.push(["credentials.describe", args]);
        const value = {};
        for (const ref of args[0] ?? []) value[ref] = { configured: Boolean(state.creds[ref]), writable: true };
        return result("credentials.describe", value);
      },
      async set(...args) { calls.push(["credentials.set", args]); state.creds[args[0]] = args[1]; return result("credentials.set"); },
      async unset(...args) { calls.push(["credentials.unset", args]); delete state.creds[args[0]]; return result("credentials.unset"); },
    },
    settings: {
      async describe(...args) {
        calls.push(["settings.describe", args]);
        return result("settings.describe", {
          writable: true,
          hasDocument: true,
          namespaces: [{ ns: "jumpserver", value: { baseUrl: state.baseUrl } }, { ns: "locale", value: { preference: "en" } }],
        });
      },
      async update(...args) { calls.push(["settings.update", args]); state.baseUrl = args[1].baseUrl; return result("settings.update"); },
      async mutate(...args) { calls.push(["settings.mutate", args]); state.baseUrl = ""; return result("settings.mutate"); },
    },
  };
}

async function faceFrom(remote) {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.section": SECTION }, remote });
  runtime.apply(host.ctx);
  await tick();
  // 组件闭包里持有 face：通过渲染出的元素 props 取回。
  return host.registered[0].component().props.jumpserverCard;
}

test("face reads and writes through ctx.get('remote.*') with exact arities", async () => {
  const remote = remoteMock({ creds: { JUMPSERVER_ACCESS_KEY_ID: "x" }, baseUrl: "https://js.example.com" });
  const face = await faceFrom(remote);

  const described = await face.describe();
  assert.equal(described.akConfigured, true);
  assert.equal(described.skConfigured, false);
  assert.equal(described.baseUrl, "https://js.example.com");
  assert.equal(await face.localePreference(), "en");

  await face.setAk("ak");
  await face.setSk("sk");
  await face.setBaseUrl("https://js2.example.com");
  await face.unsetBaseUrl();
  await face.unsetAk();
  await face.unsetSk();

  const byName = Object.fromEntries(remote.calls.map(([name, args]) => [name, args]));
  assert.equal(byName["settings.update"].length, 3, "settings.update must pass 3 args");
  assert.equal(byName["settings.mutate"].length, 3, "settings.mutate must pass 3 args");
  assert.equal(
    JSON.stringify(byName["settings.mutate"].slice(0, 2)),
    JSON.stringify(["jumpserver", [{ op: "unset", path: ["baseUrl"] }]]),
  );
  assert.equal(byName["credentials.set"].length, 2);
  assert.equal(byName["credentials.unset"].length, 1);
});

test("a rejected remote call surfaces as an error instead of looking unconfigured", async () => {
  const face = await faceFrom(remoteMock({ fail: { "settings.describe": "boom" } }));
  await assert.rejects(face.describe(), /boom/);
  const writeFail = await faceFrom(remoteMock({ fail: { "settings.update": "Config field \"baseUrl\" is not volatile" } }));
  await assert.rejects(writeFail.setBaseUrl("https://x.example.com"), /not volatile/);
});

test("a host without remote services reports it instead of hanging the plugin", async () => {
  const face = await faceFrom({});
  await assert.rejects(face.describe(), /remote\.credentials is not available/);
  assert.equal(await face.localePreference(), "");
});

// ── 服务端：volatile 门禁 ────────────────────────────────────────────

test("runtime-writable Config fields are marked volatile so the host accepts settings writes", () => {
  const fields = Config.dict ?? Config.meta?.dict ?? {};
  assert.equal(fields.baseUrl.meta.volatile, true);
  assert.equal(fields.allowInsecureHttp.meta.volatile, true);
  // 凭证引用不在设置页暴露，保持非 volatile。
  assert.notEqual(fields.akRef.meta.volatile, true);
  assert.notEqual(fields.skRef.meta.volatile, true);
});

test("unwrapVolatile unwraps cosmokit volatile references and passes plain values through", () => {
  const WRITE = Symbol.for("cosmokit.volatile.write");
  const ref = (value) => ({ [WRITE]: () => {}, get: () => value });
  const unwrapped = unwrapVolatile({ baseUrl: ref("https://js.example.com"), allowInsecureHttp: ref(false), akRef: "AK", list: [ref(1)] });
  assert.equal(JSON.stringify(unwrapped), JSON.stringify({ baseUrl: "https://js.example.com", allowInsecureHttp: false, akRef: "AK", list: [1] }));
  assert.equal(unwrapVolatile("plain"), "plain");
  assert.equal(unwrapVolatile(null), null);
});
