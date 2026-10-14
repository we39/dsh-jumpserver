import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { Config, unwrapVolatile } from "../index.js";

// ── 浏览器 bundle 加载与最小 React 替身 ────────────────────────────────

// 在 vm 沙箱里加载浏览器 bundle。react 参数用于注入 useState/useEffect 替身。
function loadBrowserModule(react = {}) {
  let definition;
  const window = {
    __ModuleLoader__: { load(value) { definition = value; } },
    confirm: () => (window.confirmAnswer ?? true),
  };
  vm.runInNewContext(
    readFileSync(new URL("../client.js", import.meta.url), "utf8"),
    { URL, window, queueMicrotask, crypto: globalThis.crypto },
  );
  const runtime = definition.factory((id) => {
    if (id === "react/jsx-runtime") {
      const node = (type, props) => ({ type, props });
      return { jsx: node, jsxs: node };
    }
    if (id === "react") return { createElement: (type, props) => ({ type, props }), ...react };
    throw new Error(`Unexpected browser dependency: ${id}`);
  });
  return { definition, runtime, window };
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
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };

const SECTION = { kind: "list", scope: "root" };
const TAB = { kind: "list", scope: "root" };
const ITEM = { kind: "keyed" };

// ── 可变的远端后端：记录实传参数个数（网关按声明个数校验）──────────────

function buildBackend({
  sources = [],
  defaultSource = "",
  creds = {},
  locale,
  legacy = {},
  legacyMigrated = false,
  fail = {},
  conflictOnce = false,
} = {}) {
  const calls = [];
  const state = {
    sources: sources.map((s) => ({ ...s })),
    defaultSource,
    legacyMigrated,
    legacy: { baseUrl: "", akRef: "JUMPSERVER_ACCESS_KEY_ID", skRef: "JUMPSERVER_ACCESS_KEY_SECRET", ...legacy },
    revision: 1,
    creds: { ...creds },
    conflictOnce,
  };
  const failState = { ...fail };
  const rejected = (what) => (failState[what] ? { ok: false, error: { message: failState[what] } } : null);
  const value = () => ({
    sources: state.sources.map((s) => ({ ...s })),
    defaultSource: state.defaultSource,
    legacyMigrated: state.legacyMigrated,
    baseUrl: state.legacy.baseUrl,
    akRef: state.legacy.akRef,
    skRef: state.legacy.skRef,
  });
  const credentials = {
    async describe(...args) {
      calls.push(["credentials.describe", args]);
      const bad = rejected("credentials.describe");
      if (bad) return bad;
      const out = {};
      for (const ref of args[0] ?? []) out[ref] = { configured: Boolean(state.creds[ref]), writable: true };
      return { ok: true, value: out };
    },
    async set(...args) {
      calls.push(["credentials.set", args]);
      const bad = rejected("credentials.set");
      if (bad) return bad;
      state.creds[args[0]] = args[1];
      return { ok: true };
    },
    async unset(...args) {
      calls.push(["credentials.unset", args]);
      const bad = rejected(`credentials.unset:${args[0]}`) ?? rejected("credentials.unset");
      if (bad) return bad;
      delete state.creds[args[0]];
      return { ok: true };
    },
  };
  const settings = {
    async describe(...args) {
      calls.push(["settings.describe", args]);
      const bad = rejected("settings.describe");
      if (bad) return bad;
      const namespaces = [{ ns: "jumpserver", value: value(), revision: state.revision }];
      if (locale !== undefined) namespaces.push({ ns: "locale", value: { preference: locale } });
      return { ok: true, value: { writable: true, hasDocument: true, namespaces } };
    },
    async mutate(...args) {
      calls.push(["settings.mutate", args]);
      const [, ops, expected] = args;
      const bad = rejected("settings.mutate");
      if (bad) return bad;
      if (state.conflictOnce) {
        state.conflictOnce = false;
        state.revision += 1;
        return { ok: false, error: { message: "settings revision changed since read" } };
      }
      if (Number.isInteger(expected) && expected !== state.revision) {
        return { ok: false, error: { message: "settings revision changed since read" } };
      }
      for (const op of ops) {
        if (op.op !== "set") continue;
        const key = op.path[0];
        if (key === "sources") state.sources = op.value.map((s) => ({ ...s }));
        else if (key === "defaultSource") state.defaultSource = op.value;
        else if (key === "legacyMigrated") state.legacyMigrated = op.value;
      }
      state.revision += 1;
      return { ok: true };
    },
  };
  return { calls, state, remote: { credentials, settings }, failState };
}

const callsOf = (backend, name) => backend.calls.filter(([n]) => n === name);

// ── 最小组件运行器：按调用顺序存取 state，真实渲染并驱动 JumpServerCard ────

async function mountCard(backend, { defaultOpen = true, confirmAnswer = true } = {}) {
  const states = [];
  const effectDeps = [];
  let stateIndex = 0;
  let effectIndex = 0;
  let pending = [];
  let tree;
  let component;
  let props;
  let rendering = false;
  let dirty = false;

  function render() {
    if (rendering) { dirty = true; return; }
    rendering = true;
    do {
      dirty = false;
      stateIndex = 0;
      effectIndex = 0;
      tree = component(props);
      const toRun = pending;
      pending = [];
      for (const effect of toRun) effect();
    } while (dirty);
    rendering = false;
  }

  const react = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (next) => {
        states[i] = typeof next === "function" ? next(states[i]) : next;
        render();
      }];
    },
    useEffect(effect, deps) {
      const i = effectIndex++;
      const prev = effectDeps[i];
      const same = prev && deps && prev.length === deps.length && prev.every((d, k) => d === deps[k]);
      if (same) return;
      effectDeps[i] = deps;
      pending.push(() => { effect(); });
    },
  };

  const { runtime, window } = loadBrowserModule(react);
  window.confirmAnswer = confirmAnswer;
  const host = buildCtx({ declared: { "settings.section": SECTION }, remote: backend.remote });
  runtime.apply(host.ctx);
  // 入口注册在微任务里完成（与真实宿主的声明时序一致），等它落地再取组件。
  await tick();
  const element = host.registered[0].component();
  component = element.type;
  props = { ...element.props, defaultOpen };
  render();

  const walk = (node, visit) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") { visit(node); return; }
    if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
    visit(node);
    walk(node.props?.children, visit);
  };
  const textOf = (node) => {
    let out = "";
    walk(node, (n) => { if (typeof n === "string" || typeof n === "number") out += String(n); });
    return out;
  };
  const all = (pred) => { const found = []; walk(tree, (n) => { if (typeof n === "object" && pred(n)) found.push(n); }); return found; };
  return {
    text: () => textOf(tree),
    buttons: (label) => all((n) => n.type === "button" && textOf(n) === label),
    button: (label, index = 0) => {
      const found = all((n) => n.type === "button" && textOf(n) === label)[index];
      assert.ok(found, `button "${label}" not found; page text: ${textOf(tree)}`);
      return found;
    },
    inputs: (placeholder) => all((n) => n.type === "input" && (placeholder === undefined || n.props.placeholder === placeholder)),
    click: async (label, index = 0) => {
      const btn = all((n) => n.type === "button" && textOf(n) === label)[index];
      assert.ok(btn, `button "${label}" not found; page text: ${textOf(tree)}`);
      assert.ok(!btn.props.disabled, `button "${label}" is disabled`);
      btn.props.onClick();
      await flush();
    },
    type: async (input, value) => { input.props.onChange({ target: { value } }); await flush(); },
    settle: flush,
    rerender: render,
  };
}

const SRC_A = { id: "id-a", name: "生产", baseUrl: "https://a.example.com", akRef: "AK_A", skRef: "SK_A" };
const SRC_B = { id: "id-b", name: "测试", baseUrl: "https://b.example.com", akRef: "AK_B", skRef: "SK_B" };
const CREDS_AB = { AK_A: "x", SK_A: "x", AK_B: "x", SK_B: "x" };

// ── 入口注册（沿用既有行为）────────────────────────────────────────────

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
  assert.equal(row.component().props.defaultOpen, true);
});

test("0.1.7 host: falls back to the settings.plugins.tab entry", async () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.plugins.tab": TAB } });
  runtime.apply(host.ctx);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugins.tab"]));
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
  host.declare("settings.section", SECTION);
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.section"]));
  host.undeclare("settings.section");
  await tick();
  assert.equal(JSON.stringify(host.liveNames()), JSON.stringify(["settings.plugins.tab"]));
});

test("host without slots.spec keeps the legacy dual registration", () => {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ withSpec: false, declared: { "settings.plugins.tab": TAB, "settings.plugin.item": ITEM } });
  runtime.apply(host.ctx);
  assert.equal(
    JSON.stringify(host.liveNames().sort()),
    JSON.stringify(["settings.plugin.item", "settings.plugins.tab"]),
  );
});

// ── face：读写契约 ────────────────────────────────────────────────────

async function faceFrom(remote) {
  const { runtime } = loadBrowserModule();
  const host = buildCtx({ declared: { "settings.section": SECTION }, remote });
  runtime.apply(host.ctx);
  await tick();
  return host.registered[0].component().props.jumpserverCard;
}

test("describe returns sources with per-source credential flags, the default, and the revision", async () => {
  const backend = buildBackend({
    sources: [SRC_A, SRC_B],
    defaultSource: "id-b",
    creds: { AK_A: "x", SK_A: "x", AK_B: "x" },
    locale: "en",
  });
  const face = await faceFrom(backend.remote);
  const r = await face.describe();
  assert.equal(r.unconfirmed, false);
  assert.equal(r.defaultSource, "id-b");
  assert.equal(r.revision, 1);
  assert.equal(r.legacy, null);
  assert.equal(JSON.stringify(r.sources.map((s) => [s.name, s.akConfigured, s.skConfigured])), JSON.stringify([["生产", true, true], ["测试", true, false]]));
  assert.equal(await face.localePreference(), "en");
  // credentials.describe 只传 ref 数组，且只问一次。
  const [credCall] = callsOf(backend, "credentials.describe");
  assert.ok(credCall[1][0].includes("AK_A") && credCall[1][0].includes("SK_B"));
});

test("a source row without refs gets the id-derived refs, matching the server", async () => {
  const backend = buildBackend({ sources: [{ id: "4d0e1971-52f8-48a5-867c-e5506fc2cf73", name: "x", baseUrl: "" }] });
  const r = await (await faceFrom(backend.remote)).describe();
  assert.equal(r.sources[0].akRef, "JUMPSERVER_AK_4d0e197152f848a5867ce5506fc2cf73");
  assert.equal(r.sources[0].skRef, "JUMPSERVER_SK_4d0e197152f848a5867ce5506fc2cf73");
});

test("describe flags malformed or missing data as unconfirmed instead of an authoritative empty list", async () => {
  const noNamespace = {
    settings: { async describe() { return { ok: true, value: { namespaces: [] } }; } },
    credentials: { async describe() { return { ok: true, value: {} }; } },
  };
  assert.equal((await (await faceFrom(noNamespace)).describe()).unconfirmed, true);

  const droppedRow = buildBackend({ sources: [SRC_A, { id: "", name: "bad" }] });
  assert.equal((await (await faceFrom(droppedRow.remote)).describe()).unconfirmed, true);

  const notArray = {
    settings: { async describe() { return { ok: true, value: { namespaces: [{ ns: "jumpserver", value: { sources: "oops" } }] } }; } },
    credentials: { async describe() { return { ok: true, value: {} }; } },
  };
  assert.equal((await (await faceFrom(notArray)).describe()).unconfirmed, true);
});

test("describe offers a legacy single-source configuration that has not been migrated yet", async () => {
  const backend = buildBackend({
    legacy: { baseUrl: "https://old.example.com", akRef: "OLD_AK", skRef: "OLD_SK" },
    creds: { OLD_AK: "x", OLD_SK: "x" },
  });
  const r = await (await faceFrom(backend.remote)).describe();
  assert.equal(JSON.stringify(r.legacy), JSON.stringify({ baseUrl: "https://old.example.com", akRef: "OLD_AK", skRef: "OLD_SK", akConfigured: true, skConfigured: true }));

  const migrated = buildBackend({ legacyMigrated: true, legacy: { baseUrl: "https://old.example.com" } });
  assert.equal((await (await faceFrom(migrated.remote)).describe()).legacy, null);

  const empty = buildBackend({});
  assert.equal((await (await faceFrom(empty.remote)).describe()).legacy, null);
});

test("writeSources sends one atomic mutate with exact arity and marks the legacy config as migrated", async () => {
  const backend = buildBackend({ sources: [SRC_A] });
  const face = await faceFrom(backend.remote);
  await face.describe();
  await face.writeSources([{ id: "id-a", name: "生产", baseUrl: "https://a.example.com" }], "id-a", 1);
  assert.equal(backend.state.revision, 2);
  const [call] = callsOf(backend, "settings.mutate");
  assert.equal(call[1].length, 3, "mutate must pass 3 args");
  const [ns, ops, revision] = call[1];
  assert.equal(ns, "jumpserver");
  assert.equal(revision, 1);
  assert.equal(JSON.stringify(ops.map((o) => [o.op, o.path[0]])), JSON.stringify([["set", "sources"], ["set", "defaultSource"], ["set", "legacyMigrated"]]));
  assert.equal(ops[2].value, true);
  // 缺省 refs 由 id 派生。
  assert.equal(ops[0].value[0].akRef, "JUMPSERVER_AK_ida");
  // 没显式传版本时，回退到最近一次 describe 读到的版本。
  await face.describe();
  await face.writeSources([], "", undefined);
  assert.equal(callsOf(backend, "settings.mutate")[1][1][2], 2);
});

test("setSecret / unsetSecret use exact positional arities and a rejection is flagged remoteRejected", async () => {
  const backend = buildBackend({});
  const face = await faceFrom(backend.remote);
  await face.setSecret("REF", "v");
  await face.unsetSecret("REF");
  assert.equal(callsOf(backend, "credentials.set")[0][1].length, 2);
  assert.equal(callsOf(backend, "credentials.unset")[0][1].length, 1);

  const rejecting = buildBackend({ fail: { "credentials.set": "denied" } });
  const f2 = await faceFrom(rejecting.remote);
  await assert.rejects(f2.setSecret("R", "v"), (e) => e.message === "denied" && e.remoteRejected === true);

  // 传输层异常（没有 ok:false 信封）= 结果未知，不得标记为 remoteRejected。
  const flaky = { credentials: { async set() { throw new Error("socket closed"); } }, settings: { async describe() { return { ok: true, value: { namespaces: [] } }; } } };
  const f3 = await faceFrom(flaky);
  await assert.rejects(f3.setSecret("R", "v"), (e) => e.message === "socket closed" && e.remoteRejected !== true);
});

test("a host without remote services reports it instead of hanging the plugin", async () => {
  const face = await faceFrom({});
  assert.equal((await face.describe()).hostUnsupported, true);
  await assert.rejects(face.writeSources([], "", 1), /HOST_UNSUPPORTED/);
  assert.equal(await face.localePreference(), "");
});

// ── 卡片：语言 ────────────────────────────────────────────────────────

test("the card defaults to Simplified Chinese, including with no or unknown locale preference", async () => {
  for (const locale of [undefined, "", "system", "zh", "zh-CN", "fr"]) {
    const card = await mountCard(buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB, locale }));
    await card.settle();
    assert.match(card.text(), /JumpServer 助手/, `locale=${JSON.stringify(locale)}`);
    assert.match(card.text(), /新增源站/);
    assert.doesNotMatch(card.text(), /Add source/);
  }
});

test("the card switches to English only when the GUI explicitly selects English", async () => {
  const card = await mountCard(buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB, locale: "en" }));
  await card.settle();
  assert.match(card.text(), /JumpServer assistant/);
  assert.match(card.text(), /Add source/);
});

test("the very first render is already Chinese (no English flash before the preference loads)", async () => {
  const card = await mountCard(buildBackend({ sources: [SRC_A], locale: "en" }));
  assert.match(card.text(), /JumpServer 助手/);
});

// ── 卡片：多源站交互 ──────────────────────────────────────────────────

test("the card lists stored sources and marks the default", async () => {
  const card = await mountCard(buildBackend({ sources: [SRC_A, SRC_B], defaultSource: "id-b", creds: CREDS_AB }));
  await card.settle();
  assert.equal(JSON.stringify(card.inputs("例如：生产 / 测试").map((i) => i.props.value)), JSON.stringify(["生产", "测试"]));
  assert.equal(card.inputs("例如：生产 / 测试").length, 2);
  assert.equal(card.buttons("默认").length, 0, "the default badge is a span, not a button");
  assert.match(card.text(), /默认/);
  // 只有非默认源站提供“设为默认”。
  assert.equal(card.buttons("设为默认").length, 1);
  assert.equal(card.buttons("移除源站").length, 2);
});

test("adding a source and saving writes its credentials under id-derived refs, then the source list", async () => {
  const backend = buildBackend({});
  const card = await mountCard(backend);
  await card.settle();
  await card.click("新增源站");
  const [nameInput] = card.inputs("例如：生产 / 测试");
  await card.type(nameInput, "  预发  ");
  await card.type(card.inputs("https://jumpserver.example.com")[0], "https://pre.example.com");
  await card.type(card.inputs("留空则保留当前值；输入新 Access Key 以替换")[0], " AK-1 ");
  await card.type(card.inputs("留空则保留当前值；输入新 Secret Key 以替换")[0], "SK-1");
  await card.click("保存当前源站");

  const sets = callsOf(backend, "credentials.set");
  assert.equal(sets.length, 2);
  const [akCall, skCall] = sets.map((c) => c[1]);
  assert.match(akCall[0], /^JUMPSERVER_AK_[A-Za-z0-9_]+$/);
  assert.match(skCall[0], /^JUMPSERVER_SK_[A-Za-z0-9_]+$/);
  assert.equal(akCall[1], "AK-1", "values are trimmed");
  assert.equal(skCall[1], "SK-1");
  // 凭证先于配置写入。
  const order = backend.calls.map(([n]) => n);
  assert.ok(order.indexOf("credentials.set") < order.indexOf("settings.mutate"));
  assert.equal(backend.state.sources.length, 1);
  assert.equal(backend.state.sources[0].name, "预发");
  assert.equal(backend.state.sources[0].baseUrl, "https://pre.example.com");
  assert.equal(backend.state.sources[0].akRef, akCall[0]);
  assert.equal(backend.state.defaultSource, backend.state.sources[0].id, "the first source becomes the default");
  assert.match(card.text(), /已保存/);
  // 回读后草稿被清空，凭证显示为已配置。
  assert.match(card.text(), /已配置/);
});

test("invalid input is rejected before ANY write happens (no half-saved credentials)", async () => {
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("新增源站");
  const names = card.inputs("例如：生产 / 测试");
  await card.type(names[1], "生产"); // 与已有源站重名
  await card.type(card.inputs("留空则保留当前值；输入新 Access Key 以替换")[1], "AK");
  await card.click("保存当前源站", 1);
  assert.match(card.text(), /源站名称必须唯一/);
  assert.equal(callsOf(backend, "credentials.set").length, 0);
  assert.equal(callsOf(backend, "settings.mutate").length, 0);

  await card.type(names[1], "新的");
  await card.type(card.inputs("https://jumpserver.example.com")[1], "ftp://nope");
  await card.click("保存当前源站", 1);
  assert.match(card.text(), /URL 必须是不含凭证/);
  assert.equal(callsOf(backend, "credentials.set").length, 0);
});

test("when the host rejects the write, credentials staged for a NEW source are reclaimed", async () => {
  const backend = buildBackend({ fail: { "settings.mutate": "denied" } });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("新增源站");
  await card.type(card.inputs("例如：生产 / 测试")[0], "新");
  await card.type(card.inputs("留空则保留当前值；输入新 Access Key 以替换")[0], "AK");
  await card.type(card.inputs("留空则保留当前值；输入新 Secret Key 以替换")[0], "SK");
  await card.click("保存当前源站");
  assert.match(card.text(), /denied/);
  const setRefs = callsOf(backend, "credentials.set").map((c) => c[1][0]).sort();
  const unsetRefs = callsOf(backend, "credentials.unset").map((c) => c[1][0]).sort();
  assert.equal(JSON.stringify(unsetRefs), JSON.stringify(setRefs), "every staged credential is reclaimed");
  assert.equal(Object.keys(backend.state.creds).length, 0);
});

test("an unknown write outcome (transport error) must NOT delete staged credentials", async () => {
  const backend = buildBackend({});
  const original = backend.remote.settings.mutate;
  backend.remote.settings.mutate = async (...args) => { await original(...args); throw new Error("socket closed"); };
  const card = await mountCard(backend);
  await card.settle();
  await card.click("新增源站");
  await card.type(card.inputs("例如：生产 / 测试")[0], "新");
  await card.type(card.inputs("留空则保留当前值；输入新 Access Key 以替换")[0], "AK");
  await card.click("保存当前源站");
  assert.equal(callsOf(backend, "credentials.unset").length, 0, "the host may already have committed — keep the credential");
  assert.equal(Object.keys(backend.state.creds).length, 1);
});

test("saving an existing source with blank key fields keeps the stored credentials untouched", async () => {
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.type(card.inputs("例如：生产 / 测试")[0], "生产-新名");
  await card.click("保存当前源站");
  assert.equal(callsOf(backend, "credentials.set").length, 0);
  assert.equal(backend.state.sources[0].name, "生产-新名");
  assert.equal(backend.state.sources[0].akRef, "AK_A", "renaming never changes the credential refs");
});

test("saving is disabled until something changed", async () => {
  const card = await mountCard(buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB }));
  await card.settle();
  assert.equal(card.button("保存当前源站").props.disabled, true);
  await card.type(card.inputs("例如：生产 / 测试")[0], "改");
  assert.equal(card.button("保存当前源站").props.disabled, false);
});

test("removing a source writes first, then clears only its own credentials", async () => {
  const backend = buildBackend({ sources: [SRC_A, SRC_B], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("移除源站", 1); // 移除“测试”
  assert.equal(JSON.stringify(backend.state.sources.map((s) => s.id)), JSON.stringify(["id-a"]));
  assert.equal(backend.state.defaultSource, "id-a");
  const unset = callsOf(backend, "credentials.unset").map((c) => c[1][0]).sort();
  assert.equal(JSON.stringify(unset), JSON.stringify(["AK_B", "SK_B"]));
  assert.equal(backend.state.creds.AK_A, "x", "the other source's credentials are untouched");
  const order = backend.calls.map(([n]) => n);
  assert.ok(order.indexOf("settings.mutate") < order.indexOf("credentials.unset"), "config is written before credentials are cleared");
});

test("removing the default source promotes a remaining one", async () => {
  const backend = buildBackend({ sources: [SRC_A, SRC_B], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("移除源站", 0);
  assert.equal(backend.state.defaultSource, "id-b");
});

test("credentials still referenced by another source are never deleted on removal", async () => {
  const shared = { ...SRC_B, akRef: "AK_A", skRef: "SK_A" };
  const backend = buildBackend({ sources: [SRC_A, shared], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("移除源站", 1);
  assert.equal(callsOf(backend, "credentials.unset").length, 0);
  assert.equal(backend.state.creds.AK_A, "x");
});

test("a credential-cleanup failure after removal is reported but does not undo the removal", async () => {
  const backend = buildBackend({ sources: [SRC_A, SRC_B], defaultSource: "id-a", creds: CREDS_AB, fail: { "credentials.unset:AK_B": "vault locked" } });
  const card = await mountCard(backend);
  await card.settle();
  await card.click("移除源站", 1);
  assert.equal(backend.state.sources.length, 1, "the source is gone");
  assert.match(card.text(), /已移除，但其凭证未能清除.*vault locked/);
});

test("declining the removal confirmation changes nothing", async () => {
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend, { confirmAnswer: false });
  await card.settle();
  await card.click("移除源站");
  assert.equal(callsOf(backend, "settings.mutate").length, 0);
  assert.equal(backend.state.sources.length, 1);
});

test("removing an unsaved new row just drops the draft without touching the host", async () => {
  const backend = buildBackend({});
  const card = await mountCard(backend);
  await card.settle();
  await card.click("新增源站");
  await card.click("移除源站");
  assert.equal(callsOf(backend, "settings.mutate").length, 0);
  assert.equal(callsOf(backend, "credentials.unset").length, 0);
  assert.equal(card.inputs("例如：生产 / 测试").length, 0);
});

test("set-as-default writes only the default and re-sends the stored list unchanged", async () => {
  const backend = buildBackend({ sources: [SRC_A, SRC_B], defaultSource: "id-a", creds: CREDS_AB });
  const card = await mountCard(backend);
  await card.settle();
  await card.type(card.inputs("例如：生产 / 测试")[0], "草稿未保存"); // 另一行的未保存草稿不得被写入
  await card.click("设为默认");
  assert.equal(backend.state.defaultSource, "id-b");
  assert.equal(backend.state.sources[0].name, "生产", "an unsaved draft is never committed by set-default");
});

test("a legacy single-source configuration can be imported and keeps its original refs", async () => {
  const backend = buildBackend({
    legacy: { baseUrl: "https://old.example.com", akRef: "JUMPSERVER_ACCESS_KEY_ID", skRef: "JUMPSERVER_ACCESS_KEY_SECRET" },
    creds: { JUMPSERVER_ACCESS_KEY_ID: "x", JUMPSERVER_ACCESS_KEY_SECRET: "x" },
  });
  const card = await mountCard(backend);
  await card.settle();
  assert.match(card.text(), /检测到旧版单源配置/);
  await card.click("导入为源站");
  await card.click("保存当前源站");
  assert.equal(callsOf(backend, "credentials.set").length, 0, "no key is re-entered or moved");
  assert.equal(backend.state.sources.length, 1);
  assert.equal(backend.state.sources[0].name, "default");
  assert.equal(backend.state.sources[0].baseUrl, "https://old.example.com");
  assert.equal(backend.state.sources[0].akRef, "JUMPSERVER_ACCESS_KEY_ID");
  assert.equal(backend.state.legacyMigrated, true);
  assert.doesNotMatch(card.text(), /检测到旧版单源配置/);
});

test("if the first read fails, nothing can be written (no empty list overwriting stored sources)", async () => {
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB, fail: { "settings.describe": "host down" } });
  const card = await mountCard(backend);
  await card.settle();
  assert.match(card.text(), /host down/);
  assert.equal(card.button("新增源站").props.disabled, true);
  assert.equal(callsOf(backend, "settings.mutate").length, 0);
  // 恢复后“重新读取”可用，并恢复写入能力。
  delete backend.failState["settings.describe"];
  await card.click("重新读取");
  assert.equal(card.button("新增源站").props.disabled, false);
  assert.equal(card.inputs("例如：生产 / 测试").length, 1);
});

test("a stale page loses to a concurrent save: the revision conflict is shown and the list is reloaded", async () => {
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB, conflictOnce: true });
  const card = await mountCard(backend);
  await card.settle();
  await card.type(card.inputs("例如：生产 / 测试")[0], "改名");
  await card.click("保存当前源站");
  assert.match(card.text(), /revision changed/);
  assert.equal(backend.state.sources[0].name, "生产", "the stale write did not land");
  // 草稿保留，重新保存即带上新版本。
  await card.click("保存当前源站");
  assert.equal(backend.state.sources[0].name, "改名");
});

test("adding a source is refused when the configuration was never read successfully (handler guard, UI bypassed)", async () => {
  // 首次读取就失败：loaded 永远是 false。此时直接调用各 handler（绕过 disabled）也不得写入。
  const backend = buildBackend({ sources: [SRC_A], defaultSource: "id-a", creds: CREDS_AB, fail: { "settings.describe": "host down" } });
  const card = await mountCard(backend);
  await card.settle();
  assert.match(card.text(), /host down/);
  // 绕过按钮的 disabled，直接触发 handler：这是“空基线覆盖已存源站”的最后一道闸。
  card.button("新增源站").props.onClick();
  await card.settle();
  assert.match(card.text(), /尚未成功读取配置/);
  assert.equal(callsOf(backend, "settings.mutate").length, 0);
  assert.equal(callsOf(backend, "credentials.set").length, 0);
  assert.equal(card.inputs("例如：生产 / 测试").length, 0, "no draft row may be created without a baseline");
});

// ── 服务端：volatile 门禁 ────────────────────────────────────────────

test("runtime-writable Config fields are marked volatile so the host accepts settings writes", () => {
  const fields = Config.dict ?? Config.meta?.dict ?? {};
  for (const key of ["sources", "defaultSource", "legacyMigrated", "baseUrl", "allowInsecureHttp"]) {
    assert.equal(fields[key].meta.volatile, true, key);
  }
  // 旧版凭证引用不在设置页暴露，保持非 volatile。
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
