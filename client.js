// dsh-jumpserver 浏览器设置卡片。
// DSH 0.1.2：AccessKeyID / AccessKeySecret 走 ctx.remote.credentials（凭证库 Remote），
// 仅写不读，describe 只返回 configured 布尔，客户端永远不会读回明文，故以星号占位。
// baseUrl 不是敏感信息，存 settings namespace（jumpserver）：settings.describe 对
// 非 secret 字段返回明文 value，因此保存后可直接回显核对。
window.__ModuleLoader__.load({
  id: "dsh-jumpserver",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");

    const AK_REF = "JUMPSERVER_ACCESS_KEY_ID";
    const SK_REF = "JUMPSERVER_ACCESS_KEY_SECRET";
    const SETTINGS_NS = "jumpserver";
    // 仅用于视觉提示的占位符，永远不会写入凭证库。
    const MASK = "*".repeat(28);
    // 只 inject slots。远端门面（remote.settings / remote.credentials）刻意不写进 inject：
    // cordis 4.0.2 中任一 inject 项缺席都会让整个插件永久停在 INACTIVE，卡片连同
    // 其它功能一起消失；改为调用时用 ctx.get 按需解析，缺席时只让卡片报错。
    const inject = ["slots"];

    const STRINGS = {
      zh: {
        title: "JumpServer 资产查询",
        desc: "通过对话查询 JumpServer 资产。AccessKey 仅保存在本地，永远不会被显示。",
        akLabel: "Access Key",
        skLabel: "Secret Key",
        configured: "已配置",
        notConfigured: "未配置",
        akPlaceholder: "留空则保留当前值；输入新 Access Key 以替换",
        skPlaceholder: "留空则保留当前值；输入新 Secret Key 以替换",
        hintConfigured: "已配置。星号只是占位符，并非存储的值。",
        hintEmpty: "存储在本地 DSH 凭证库中，凭证值永远不会被读回。",
        removeAk: "移除 Access Key",
        removeSk: "移除 Secret Key",
        urlPlaceholderConfigured: "输入新 URL 以替换",
        urlPlaceholderEmpty: "https://jumpserver.example.com",
        urlHint: "支持 HTTP 与 HTTPS。URL 保存在设置中，保存后会在此显示以便核对。",
        removeUrl: "移除 URL",
        saving: "保存中…",
        save: "保存",
        saved: "已保存。新会话将使用更新后的配置。",
        invalidUrl: "JumpServer URL 必须是不含凭证、查询参数或片段的绝对 HTTP(S) 地址。",
        confirmRemoveAk: "确定要移除已存储的 Access Key 吗？",
        confirmRemoveSk: "确定要移除已存储的 Secret Key 吗？",
        confirmRemoveUrl: "确定要移除已存储的 JumpServer URL 吗？"
      },
      en: {
        title: "JumpServer asset lookup",
        desc: "Query JumpServer assets through conversation. The AccessKey is stored locally and never displayed.",
        akLabel: "Access Key",
        skLabel: "Secret Key",
        configured: "Configured",
        notConfigured: "Not configured",
        akPlaceholder: "Leave blank to keep the current value; enter a new Access Key to replace it",
        skPlaceholder: "Leave blank to keep the current value; enter a new Secret Key to replace it",
        hintConfigured: "Configured. The stars are a placeholder, not the stored value.",
        hintEmpty: "Stored in the local DSH credential store; the value is never read back.",
        removeAk: "Remove Access Key",
        removeSk: "Remove Secret Key",
        urlPlaceholderConfigured: "Enter a new URL to replace it",
        urlPlaceholderEmpty: "https://jumpserver.example.com",
        urlHint: "HTTP and HTTPS are both supported. The URL is stored in settings and shown here after saving.",
        removeUrl: "Remove URL",
        saving: "Saving…",
        save: "Save",
        saved: "Saved. New conversations will use the updated configuration.",
        invalidUrl: "JumpServer URL must be an absolute HTTP(S) URL without credentials, query, or fragment.",
        confirmRemoveAk: "Remove the stored Access Key?",
        confirmRemoveSk: "Remove the stored Secret Key?",
        confirmRemoveUrl: "Remove the stored JumpServer URL?"
      }
    };

    // 非浏览器环境（如测试沙箱）中没有 navigator，回退为英文。
    function detectLanguage() {
      try {
        if (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh")) return "zh";
      } catch { /* 忽略，走默认。 */ }
      return "en";
    }

    const S = {
      // 折叠卡片外壳对齐官方 PluginCard（ui-settings-plugins 包）的观感：
      // 收起时用 bg-layer-3，展开后切换到 bg-layer-2。
      card: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-layer-3)", marginBottom: "12px" },
      cardOpen: { background: "var(--dsw-alias-bg-layer-2)" },
      header: { display: "flex", alignItems: "center", gap: "12px", width: "100%", padding: "16px", margin: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" },
      headerText: { display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 auto", minWidth: 0 },
      chevron: { flexShrink: 0, display: "inline-flex", transition: "transform .16s", color: "var(--dsw-alias-label-tertiary)" },
      body: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", padding: "16px 0", display: "flex", flexDirection: "column", gap: "12px" },
      title: { margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
      desc: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-secondary)" },
      row: { display: "flex", flexDirection: "column", gap: "6px" },
      head: { display: "flex", alignItems: "center", gap: "8px" },
      label: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
      inputRow: { display: "flex", alignItems: "center", gap: "8px" },
      input: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", flex: "1 1 auto", minWidth: 0 },
      hint: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
      badge: { whiteSpace: "nowrap", borderRadius: "999px", padding: "1px 8px", fontSize: "11px", fontWeight: 500, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", display: "inline-block" },
      badgeOk: { color: "#2f9e44" },
      footer: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      button: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", height: "32px", padding: "0 14px", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
      msg: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
      err: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-error)" }
    };

    function JumpServerCard(props) {
      const face = props.jumpserverCard;
      const [status, setStatus] = react.useState({ loaded: false, ak: false, sk: false, base: false });
      const [akDraft, setAkDraft] = react.useState("");
      const [skDraft, setSkDraft] = react.useState("");
      const [baseDraft, setBaseDraft] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      const [saved, setSaved] = react.useState(false);
      const [error, setError] = react.useState("");
      const [akFocus, setAkFocus] = react.useState(false);
      const [skFocus, setSkFocus] = react.useState(false);
      const [lang, setLang] = react.useState(detectLanguage);
      // 展开状态是卡片本地的阅读手势，Host 与设置页都不参与（同官方 PluginCard）。
      const [open, setOpen] = react.useState(props.defaultOpen === true);
      const T = STRINGS[lang] ?? STRINGS.en;

      // 已配置时显示虚假掩码；聚焦后展示空白的替换草稿。
      const akValue = status.ak && !akFocus && akDraft === "" ? MASK : akDraft;
      const skValue = status.sk && !skFocus && skDraft === "" ? MASK : skDraft;

      react.useEffect(() => {
        let alive = true;
        face.describe().then((r) => {
          if (!alive) return;
          setStatus({ loaded: true, ak: r.akConfigured, sk: r.skConfigured, base: r.baseConfigured });
          // URL 存 settings namespace（非 secret），describe 直接返回明文，可靠回显。
          if (r.baseUrl) setBaseDraft(r.baseUrl);
        }).catch((e) => { if (alive) setError(String(e?.message ?? e)); });
        return () => { alive = false; };
      }, [face]);

      // GUI 自身的语言偏好（locale 命名空间）优先于浏览器语言。
      react.useEffect(() => {
        let alive = true;
        face.localePreference().then((p) => {
          if (alive && (p === "zh" || p === "en")) setLang(p);
        }).catch(() => {});
        return () => { alive = false; };
      }, [face]);

      async function onSave() {
        setSaving(true);
        setSaved(false);
        setError("");
        try {
          const ak = akDraft.trim();
          const sk = skDraft.trim();
          const b = baseDraft.trim();
          if (ak !== "") await face.setAk(ak);
          if (sk !== "") await face.setSk(sk);
          if (b !== "") {
            const url = new URL(b);
            if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
              throw new Error(T.invalidUrl);
            }
            await face.setBaseUrl(b);
          }
          const r = await face.describe();
          setStatus({ loaded: true, ak: r.akConfigured, sk: r.skConfigured, base: r.baseConfigured });
          setAkDraft("");
          setSkDraft("");
          setAkFocus(false);
          setSkFocus(false);
          setBaseDraft(b !== "" ? b : (r.baseConfigured ? r.baseUrl : ""));
          setSaved(true);
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setSaving(false);
        }
      }

      async function onClear(kind) {
        const message = kind === "ak" ? T.confirmRemoveAk : kind === "sk" ? T.confirmRemoveSk : T.confirmRemoveUrl;
        if (!window.confirm(message)) return;
        setSaving(true);
        setSaved(false);
        setError("");
        try {
          // AK/SK 走凭证库；base URL 走 settings namespace，移除路径不同。
          if (kind === "ak") await face.unsetAk();
          else if (kind === "sk") await face.unsetSk();
          else await face.unsetBaseUrl();
          const r = await face.describe();
          setStatus({ loaded: true, ak: r.akConfigured, sk: r.skConfigured, base: r.baseConfigured });
          if (kind === "ak") { setAkDraft(""); setAkFocus(false); }
          if (kind === "sk") { setSkDraft(""); setSkFocus(false); }
          if (kind === "base") setBaseDraft("");
          setSaved(true);
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setSaving(false);
        }
      }

      return (0, react_jsx_runtime.jsxs)("section", { style: open ? { ...S.card, ...S.cardOpen } : S.card, children: [
        (0, react_jsx_runtime.jsxs)("button", { type: "button", style: S.header, "aria-expanded": open, onClick: () => setOpen(!open), children: [
          (0, react_jsx_runtime.jsxs)("span", { style: S.headerText, children: [
            (0, react_jsx_runtime.jsx)("span", { style: S.title, children: T.title }),
            (0, react_jsx_runtime.jsx)("span", { style: S.desc, children: T.desc })
          ] }),
          (0, react_jsx_runtime.jsx)("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { ...S.chevron, transform: open ? "rotate(180deg)" : "none" }, children:
            (0, react_jsx_runtime.jsx)("path", { d: "M3.5 5.25 7 8.75 10.5 5.25", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
          })
        ] }),
        open ? (0, react_jsx_runtime.jsxs)("div", { style: S.body, children: [
          (0, react_jsx_runtime.jsxs)("div", { style: S.row, children: [
            (0, react_jsx_runtime.jsxs)("div", { style: S.head, children: [
              (0, react_jsx_runtime.jsx)("label", { style: S.label, children: "JumpServer URL" }),
              status.loaded ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, ...(status.base ? S.badgeOk : {}) }, children: status.base ? T.configured : T.notConfigured }) : null
            ] }),
            (0, react_jsx_runtime.jsxs)("div", { style: S.inputRow, children: [
              (0, react_jsx_runtime.jsx)("input", { type: "url", style: S.input, placeholder: status.base ? T.urlPlaceholderConfigured : T.urlPlaceholderEmpty, value: baseDraft, onChange: (e) => setBaseDraft(e.target.value) }),
              status.base ? (0, react_jsx_runtime.jsx)("button", { style: S.button, disabled: saving, onClick: () => onClear("base"), children: T.removeUrl }) : null
            ] }),
            (0, react_jsx_runtime.jsx)("p", { style: S.hint, children: T.urlHint })
          ] }),
          (0, react_jsx_runtime.jsxs)("div", { style: S.row, children: [
            (0, react_jsx_runtime.jsxs)("div", { style: S.head, children: [
              (0, react_jsx_runtime.jsx)("label", { style: S.label, children: T.akLabel }),
              status.loaded ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, ...(status.ak ? S.badgeOk : {}) }, children: status.ak ? T.configured : T.notConfigured }) : null
            ] }),
            (0, react_jsx_runtime.jsxs)("div", { style: S.inputRow, children: [
              (0, react_jsx_runtime.jsx)("input", { type: "password", style: S.input, placeholder: T.akPlaceholder, value: akValue, onFocus: () => setAkFocus(true), onBlur: () => { if (akDraft === "") setAkFocus(false); }, onChange: (e) => {
                let v = e.target.value;
                if (v.startsWith(MASK)) v = v.slice(MASK.length);
                setAkDraft(v);
              } }),
              status.ak ? (0, react_jsx_runtime.jsx)("button", { style: S.button, disabled: saving, onClick: () => onClear("ak"), children: T.removeAk }) : null
            ] }),
            (0, react_jsx_runtime.jsx)("p", { style: S.hint, children: status.ak ? T.hintConfigured : T.hintEmpty })
          ] }),
          (0, react_jsx_runtime.jsxs)("div", { style: S.row, children: [
            (0, react_jsx_runtime.jsxs)("div", { style: S.head, children: [
              (0, react_jsx_runtime.jsx)("label", { style: S.label, children: T.skLabel }),
              status.loaded ? (0, react_jsx_runtime.jsx)("span", { style: { ...S.badge, ...(status.sk ? S.badgeOk : {}) }, children: status.sk ? T.configured : T.notConfigured }) : null
            ] }),
            (0, react_jsx_runtime.jsxs)("div", { style: S.inputRow, children: [
              (0, react_jsx_runtime.jsx)("input", { type: "password", style: S.input, placeholder: T.skPlaceholder, value: skValue, onFocus: () => setSkFocus(true), onBlur: () => { if (skDraft === "") setSkFocus(false); }, onChange: (e) => {
                let v = e.target.value;
                if (v.startsWith(MASK)) v = v.slice(MASK.length);
                setSkDraft(v);
              } }),
              status.sk ? (0, react_jsx_runtime.jsx)("button", { style: S.button, disabled: saving, onClick: () => onClear("sk"), children: T.removeSk }) : null
            ] }),
            (0, react_jsx_runtime.jsx)("p", { style: S.hint, children: status.sk ? T.hintConfigured : T.hintEmpty })
          ] }),
          (0, react_jsx_runtime.jsxs)("div", { style: S.footer, children: [
            (0, react_jsx_runtime.jsx)("button", { style: S.button, disabled: saving, onClick: onSave, children: saving ? T.saving : T.save }),
            saved ? (0, react_jsx_runtime.jsx)("p", { style: S.msg, children: T.saved }) : null,
            error ? (0, react_jsx_runtime.jsx)("p", { style: S.err, children: error }) : null
          ] })
        ] }) : null
      ] });
    }

    // 宿主远端门面（dsh 0.1.2+）：settings / credentials 由 dsh-api-gateway 以
    // remote.<ns> 之名挂载。必须用 ctx.get 读而不是 ctx.remote.<ns>：未声明 inject 的
    // 点号访问会直接抛错，而 ctx.get 在服务缺席时只返回 undefined。
    function remoteNamespace(ctx, ns) {
      return typeof ctx.get === "function" ? ctx.get(`remote.${ns}`) : undefined;
    }

    // remote.* 一律返回 { ok, value } 或 { ok:false, error:{ message } }。
    // 失败必须抛出可读信息：静默降级成空数据会把故障伪装成“没有配置”。
    function unwrap(res, what) {
      if (res && typeof res === "object" && res.ok === true) return res.value;
      const message = (res && typeof res === "object" ? res.error?.message : undefined) || `${what} failed`;
      throw new Error(message);
    }

    function requireNamespace(ctx, ns) {
      const api = remoteNamespace(ctx, ns);
      if (!api) throw new Error(`remote.${ns} is not available on this DeepSeek Harness host`);
      return api;
    }

    // 设置入口注册：不同代际的宿主暴露的槽位不同，按优先级选第一个可用的。
    //   settings.section      0.2.0+  设置页左侧独立分区（root/list）
    //   settings.plugins.tab  0.1.7+  “插件”分区内的标签页（root/list）
    //   settings.plugin.item  ≤0.1.5  内嵌卡片（keyed）；0.1.7 起已从槽位目录移除
    // 只注册一个，避免同一个卡片出现两次。
    function registerSettingsEntry(ctx, face) {
      const candidates = [
        {
          name: "settings.section", kind: "list", scope: "root",
          options: { name: "settings.section", id: "jumpserver", order: 17, label: "JumpServer" },
          component: () => react.createElement(JumpServerCard, { jumpserverCard: face, defaultOpen: true })
        },
        {
          name: "settings.plugins.tab", kind: "list", scope: "root",
          options: { name: "settings.plugins.tab", id: "jumpserver", order: 101, label: "JumpServer" },
          component: () => react.createElement(JumpServerCard, { jumpserverCard: face })
        },
        {
          name: "settings.plugin.item", kind: "keyed",
          options: { name: "settings.plugin.item", key: "jumpserver", inject: () => ({ jumpserverCard: face }) },
          component: JumpServerCard
        }
      ];
      // 没有声明探测接口（ctx.slots.spec）的老宿主：保持原先的注册方式，由各自宿主消费。
      if (typeof ctx.slots.spec !== "function") {
        for (const candidate of candidates.slice(1)) {
          ctx.slots.inject(candidate.name, () => ctx.slots.register(candidate.options, candidate.component));
        }
        return;
      }
      ctx.effect(() => {
        const available = new Map();
        const waits = [];
        let active;
        let unregister;
        let queued = false;
        let stopped = false;
        const reconcile = () => {
          if (stopped || queued) return;
          queued = true;
          // 在声明/撤销回调之外注册，并把同一轮槽位变化合并为一次切换，不制造重复入口。
          queueMicrotask(() => {
            queued = false;
            if (stopped) return;
            const next = candidates.map((candidate) => available.get(candidate.name)).find(Boolean);
            if (next === active) return;
            unregister?.();
            unregister = void 0;
            active = void 0;
            if (next) {
              try {
                unregister = ctx.slots.register(next.options, next.component);
                active = next;
              } catch (error) {
                // Fiber 卸载可能先于本控制器的清理；待执行微任务不得复活入口。
                if (error?.code !== "INACTIVE_EFFECT") throw error;
                stop();
              }
            }
          });
        };
        const stop = () => {
          if (stopped) return;
          stopped = true;
          const disposeActive = unregister;
          unregister = void 0;
          active = void 0;
          disposeActive?.();
          for (const dispose of waits.reverse()) dispose?.();
          available.clear();
        };
        try {
          for (const candidate of candidates) waits.push(ctx.slots.inject(candidate.name, () => {
            const spec = ctx.slots.spec(candidate.name);
            if (spec?.kind !== candidate.kind || (candidate.scope && spec.scope !== candidate.scope)) return;
            // 每个声明生命周期用新对象标识；同 tick 撤销并重声明同名槽时也须重挂。
            const lifetime = { ...candidate };
            available.set(candidate.name, lifetime);
            reconcile();
            return () => {
              if (available.get(candidate.name) === lifetime) available.delete(candidate.name);
              reconcile();
            };
          }));
        } catch (error) {
          stop();
          throw error;
        }
        return stop;
      }, "dsh-jumpserver: settings navigation");
    }

    function apply(ctx) {
      // Remote 调用返回 RemoteResult {ok:true,value}|{ok:false,error}，失败须抛出让 UI 报错。
      const credentials = () => requireNamespace(ctx, "credentials");
      const settings = () => requireNamespace(ctx, "settings");
      const face = {
        describe: async () => {
          // AK/SK 走凭证库（只返回 configured）；URL 走 settings namespace（非 secret，返回明文）。
          const [credRes, setRes] = await Promise.all([
            credentials().describe([AK_REF, SK_REF]),
            settings().describe(),
          ]);
          const creds = unwrap(credRes, "credentials.describe") ?? {};
          const namespaces = unwrap(setRes, "settings.describe")?.namespaces ?? [];
          const jsNs = namespaces.find((n) => n?.ns === SETTINGS_NS);
          const baseUrl = typeof jsNs?.value?.baseUrl === "string" ? jsNs.value.baseUrl : "";
          return {
            akConfigured: creds[AK_REF]?.configured ?? false,
            skConfigured: creds[SK_REF]?.configured ?? false,
            baseConfigured: Boolean(baseUrl),
            baseUrl,
          };
        },
        setAk: async (value) => unwrap(await credentials().set(AK_REF, value), "credentials.set"),
        setSk: async (value) => unwrap(await credentials().set(SK_REF, value), "credentials.set"),
        // URL 存 settings namespace：update 做 deep-merge，不动其它字段。
        // 网关按声明的参数个数校验实传个数，无 CAS 需求时第三参也要显式传 undefined。
        setBaseUrl: async (value) => unwrap(await settings().update(SETTINGS_NS, { baseUrl: value }, undefined), "settings.update"),
        unsetAk: async () => unwrap(await credentials().unset(AK_REF), "credentials.unset"),
        unsetSk: async () => unwrap(await credentials().unset(SK_REF), "credentials.unset"),
        // URL 移除走 settings.mutate：浏览器只持有 redacted 视图，
        // replace wholesale 会误删 schema 里其它已存字段，故用单字段 op。
        unsetBaseUrl: async () => unwrap(await settings().mutate(SETTINGS_NS, [{ op: "unset", path: ["baseUrl"] }], undefined), "settings.mutate"),
        // 读取 GUI 的语言偏好（locale 命名空间的 preference 字段）；不可用时返回空串。
        localePreference: async () => {
          const api = remoteNamespace(ctx, "settings");
          if (!api) return "";
          const res = await api.describe();
          if (!res?.ok) return "";
          const locale = (res.value?.namespaces ?? []).find((n) => n?.ns === "locale");
          const pref = locale?.value?.preference;
          return typeof pref === "string" ? pref : "";
        }
      };

      registerSettingsEntry(ctx, face);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
