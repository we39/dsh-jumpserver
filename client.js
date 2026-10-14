// dsh-jumpserver 浏览器设置卡片（多源站）。
// 每个源站有自己的名称、URL 与 AccessKeyID / AccessKeySecret：
// 名称、URL、defaultSource 存 settings namespace（jumpserver，非 secret，明文回显）；
// 密钥走 remote.credentials（凭证库），仅写不读，describe 只返回 configured 布尔，
// 客户端永远不会读回明文，故以星号占位。默认简体中文，仅当 GUI 明确选择英文时切换。
window.__ModuleLoader__.load({
  id: "dsh-jumpserver",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react_jsx_runtime = require("react/jsx-runtime");
    let react = require("react");

    // 旧版（单源）凭证引用：仅用于识别并导入旧配置。
    const LEGACY_AK_REF = "JUMPSERVER_ACCESS_KEY_ID";
    const LEGACY_SK_REF = "JUMPSERVER_ACCESS_KEY_SECRET";
    // 新源站的凭证引用由源站 id 派生，必须与服务端 akRefForId / skRefForId 一致。
    const AK_REF_PREFIX = "JUMPSERVER_AK_";
    const SK_REF_PREFIX = "JUMPSERVER_SK_";
    const SETTINGS_NS = "jumpserver";
    const DEFAULT_SOURCE_NAME = "default";
    const MAX_SOURCES = 50;
    const MAX_SOURCE_NAME_CHARS = 100;
    // 仅用于视觉提示的占位符，永远不会写入凭证库。
    const MASK = "*".repeat(28);
    // 只 inject slots。远端门面（remote.settings / remote.credentials）刻意不写进 inject：
    // cordis 4.0.2 中任一 inject 项缺席都会让整个插件永久停在 INACTIVE，卡片连同
    // 其它功能一起消失；改为调用时用 ctx.get 按需解析，缺席时只让卡片报错。
    const inject = ["slots"];

    const STRINGS = {
      zh: {
        title: "JumpServer 助手",
        desc: "让 DSH 连接多个 JumpServer 源站；人类讲需求，AI 去干活，查询并管理资产、用户、账号、授权与审计。",
        sourcesHeading: "JumpServer 源站",
        sourcesNote: "凭证库可能由多个 profile 共用。移除源站时只会清除该源站专属的 Access Key / Secret Key；若仍被其它源站共用则会保留。",
        sourcesEmpty: "尚未配置源站。点击“新增源站”添加一个。",
        addSource: "新增源站",
        sourceNameLabel: "源站名称",
        sourceNamePlaceholder: "例如：生产 / 测试",
        uidLabel: "UID（自动生成、全球唯一、不可修改）",
        urlLabel: "JumpServer URL",
        urlPlaceholder: "https://jumpserver.example.com",
        urlHint: "支持 HTTP 与 HTTPS（HTTP 会明文传输签名请求，建议优先使用 HTTPS）。",
        akLabel: "Access Key（AccessKeyID）",
        skLabel: "Secret Key（AccessKeySecret）",
        configured: "已配置",
        notConfigured: "未配置",
        akPlaceholder: "留空则保留当前值；输入新 Access Key 以替换",
        skPlaceholder: "留空则保留当前值；输入新 Secret Key 以替换",
        hintConfigured: "已配置。星号只是占位符，并非存储的值。",
        hintEmpty: "存储在本地 DSH 凭证库中，凭证值永远不会被读回。",
        defaultBadge: "默认",
        unsavedBadge: "未保存",
        setDefault: "设为默认",
        removeSource: "移除源站",
        saveCurrentSource: "保存当前源站",
        saving: "保存中…",
        saved: "已保存。新会话将使用更新后的配置。",
        reload: "重新读取",
        importLegacyTitle: "检测到旧版单源配置",
        importLegacyDesc: "发现此前保存的单个 JumpServer 配置，尚未出现在源站列表中。导入后将沿用原有的 Access Key / Secret Key，不会重新输入或搬运密钥。",
        importLegacy: "导入为源站",
        nameRequired: "源站名称不能为空。",
        nameDuplicate: "源站名称必须唯一。",
        nameTooLong: "源站名称不能超过 100 个字符。",
        tooManySources: "源站数量不能超过 50 个。",
        invalidUrl: "JumpServer URL 必须是不含凭证、查询参数或片段的绝对 HTTP(S) 地址。",
        confirmRemoveSource: "确定要移除该源站吗？其专用的 Access Key / Secret Key 会一并清除；若仍被其它源站共用则会保留。",
        notLoaded: "尚未成功读取配置，为避免覆盖已有源站，保存已停用。请点击“重新读取”。",
        unconfirmedRead: "宿主返回的配置数据无法解析（不是合法的源站列表）。为避免覆盖已存源站或误删凭证，已暂停写入；请点击“重新读取”。",
        cleanupFailed: "源站“{name}”已移除，但其凭证未能清除（{ref}）：",
        stagedCleanupFailed: "保存未生效，暂存的新凭证（{ref}）未能回收：",
        hostTooOld: "当前 DSH 宿主版本过旧（缺少 remote.settings 远端门面），无法读写 JumpServer 源站配置。请升级后重新打开设置页。"
      },
      en: {
        title: "JumpServer assistant",
        desc: "Let DSH talk to several JumpServer sources: you describe the goal, the AI does the work across assets, users, accounts, permissions and audit.",
        sourcesHeading: "JumpServer sources",
        sourcesNote: "The credential store may be shared by several profiles. Removing a source clears only that source's own Access Key / Secret Key; they are kept if another source still uses them.",
        sourcesEmpty: "No sources yet. Click “Add source” to create one.",
        addSource: "Add source",
        sourceNameLabel: "Source name",
        sourceNamePlaceholder: "e.g. production / staging",
        uidLabel: "UID (auto-generated, globally unique, read-only)",
        urlLabel: "JumpServer URL",
        urlPlaceholder: "https://jumpserver.example.com",
        urlHint: "HTTP and HTTPS are both supported (HTTP sends signed requests in clear text; prefer HTTPS).",
        akLabel: "Access Key (AccessKeyID)",
        skLabel: "Secret Key (AccessKeySecret)",
        configured: "Configured",
        notConfigured: "Not configured",
        akPlaceholder: "Leave blank to keep the current value; enter a new Access Key to replace it",
        skPlaceholder: "Leave blank to keep the current value; enter a new Secret Key to replace it",
        hintConfigured: "Configured. The stars are a placeholder, not the stored value.",
        hintEmpty: "Stored in the local DSH credential store; the value is never read back.",
        defaultBadge: "Default",
        unsavedBadge: "Unsaved",
        setDefault: "Set as default",
        removeSource: "Remove source",
        saveCurrentSource: "Save this source",
        saving: "Saving…",
        saved: "Saved. New conversations will use the updated configuration.",
        reload: "Reload",
        importLegacyTitle: "Legacy single-source configuration found",
        importLegacyDesc: "A previously saved single JumpServer configuration is not in the source list yet. Importing it reuses the existing Access Key / Secret Key — nothing is re-entered or moved.",
        importLegacy: "Import as a source",
        nameRequired: "A source name is required.",
        nameDuplicate: "Source names must be unique.",
        nameTooLong: "A source name must not exceed 100 characters.",
        tooManySources: "At most 50 sources can be configured.",
        invalidUrl: "JumpServer URL must be an absolute HTTP(S) URL without credentials, query, or fragment.",
        confirmRemoveSource: "Remove this source? Its own Access Key / Secret Key are cleared too, unless another source still uses them.",
        notLoaded: "The configuration has not been read successfully, so saving is disabled to avoid overwriting existing sources. Click “Reload”.",
        unconfirmedRead: "The host returned configuration data that could not be parsed (not a valid source list). Writes are paused to avoid overwriting stored sources or deleting credentials; click “Reload”.",
        cleanupFailed: "Source “{name}” was removed, but its credential could not be cleared ({ref}): ",
        stagedCleanupFailed: "The save did not take effect and the staged new credential ({ref}) could not be reclaimed: ",
        hostTooOld: "This DSH host is too old (no remote.settings facade), so JumpServer sources cannot be read or written. Upgrade and reopen the settings page."
      }
    };

    const HOST_UNSUPPORTED = "HOST_UNSUPPORTED";

    // ── 纯函数（与服务端规则保持一致）──────────────────────────────────

    // 源站 id：优先 crypto.randomUUID，退化到 getRandomValues，最后退化到时间+随机串。
    function generateSourceId() {
      const c = typeof crypto !== "undefined" ? crypto : undefined;
      if (c && c.randomUUID) return String(c.randomUUID());
      if (c && c.getRandomValues) {
        const bytes = c.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
        return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
      }
      return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
    function cleanId(id) {
      return String(id == null ? "" : id).replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);
    }
    function akRefForId(id) { return AK_REF_PREFIX + cleanId(id); }
    function skRefForId(id) { return SK_REF_PREFIX + cleanId(id); }

    // 一行源站的持久化形态（不含草稿字段）。
    function storedRow(s) {
      return {
        id: s.id,
        name: String(s.name == null ? "" : s.name),
        baseUrl: String(s.baseUrl == null ? "" : s.baseUrl),
        akRef: s.akRef || akRefForId(s.id),
        skRef: s.skRef || skRefForId(s.id)
      };
    }

    function validateSources(rows, m) {
      if (rows.length > MAX_SOURCES) throw new Error(m.tooManySources);
      const seen = new Set();
      for (const s of rows) {
        const name = String(s.name == null ? "" : s.name).trim();
        if (!name) throw new Error(m.nameRequired);
        if (name.length > MAX_SOURCE_NAME_CHARS) throw new Error(m.nameTooLong);
        if (seen.has(name)) throw new Error(m.nameDuplicate);
        seen.add(name);
        const url = String(s.baseUrl == null ? "" : s.baseUrl).trim();
        if (url) {
          let u;
          try { u = new URL(url); } catch { throw new Error(m.invalidUrl); }
          if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) {
            throw new Error(m.invalidUrl);
          }
        }
      }
    }

    // 草稿相对已存基线是否有改动（含从未保存的新行、待写入的密钥）。
    function rowDirty(draft, storedById) {
      const st = storedById.get(draft.id);
      if (!st) return true;
      if (String(draft.akDraft || "").trim() !== "" || String(draft.skDraft || "").trim() !== "") return true;
      const a = storedRow({ ...draft, name: String(draft.name || "").trim(), baseUrl: String(draft.baseUrl || "").trim() });
      const b = storedRow(st);
      return a.name !== b.name || a.baseUrl !== b.baseUrl || a.akRef !== b.akRef || a.skRef !== b.skRef;
    }

    // 写入后回读并合并：以存储为准刷新权威字段与凭证状态，保留其它行未保存的草稿。
    function mergeDrafts(described, drafts, committedIds) {
      const describedIds = new Set(described.map((s) => s.id));
      const draftById = new Map(drafts.map((s) => [s.id, s]));
      const merged = described.map((s) => {
        const d = draftById.get(s.id);
        const base = { ...s, akDraft: "", skDraft: "", akFocus: false, skFocus: false };
        if (!d) return base;
        // 刚提交成功的行：以存储为准，草稿清空；其它行：保留用户正在编辑的内容。
        if (committedIds && committedIds.has(s.id)) return base;
        return { ...base, name: d.name, baseUrl: d.baseUrl, akDraft: d.akDraft || "", skDraft: d.skDraft || "", akFocus: !!d.akFocus, skFocus: !!d.skFocus };
      });
      // 存储里缺席的草稿：从未持久化的新行原样保留，免得被回读冲掉。
      for (const d of drafts) if (!describedIds.has(d.id) && !d.persisted) merged.push({ ...d });
      return merged;
    }

    function pickDefault(candidates, preferred) {
      return candidates.some((s) => s.id === preferred) ? preferred : (candidates[0] ? candidates[0].id : "");
    }

    // Web 与桌面端统一默认简体中文，不依赖浏览器或 Electron 的语言；
    // 只有 GUI 明确选择了英文才切换。
    function languageFor(preference) {
      return preference === "en" ? "en" : "zh";
    }

    const S = {
      // 折叠卡片外壳对齐官方 PluginCard 的观感：收起时 bg-layer-3，展开后 bg-layer-2。
      card: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", background: "var(--dsw-alias-bg-layer-3)", marginBottom: "12px" },
      cardOpen: { background: "var(--dsw-alias-bg-layer-2)" },
      header: { display: "flex", alignItems: "center", gap: "12px", width: "100%", padding: "16px", margin: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" },
      headerText: { display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 auto", minWidth: 0 },
      chevron: { flexShrink: 0, display: "inline-flex", transition: "transform .16s", color: "var(--dsw-alias-label-tertiary)" },
      body: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", padding: "16px 0", display: "flex", flexDirection: "column", gap: "12px" },
      title: { margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
      desc: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-secondary)" },
      heading: { margin: "4px 0 0", fontSize: "14px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
      source: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px", background: "var(--dsw-alias-bg-layer-3)" },
      row: { display: "flex", flexDirection: "column", gap: "6px" },
      head: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
      label: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
      inputRow: { display: "flex", alignItems: "center", gap: "8px" },
      input: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", height: "34px", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", padding: "0 12px", fontSize: "13px", flex: "1 1 auto", minWidth: 0 },
      hint: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-tertiary)" },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
      badge: { whiteSpace: "nowrap", borderRadius: "999px", padding: "1px 8px", fontSize: "11px", fontWeight: 500, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", display: "inline-block" },
      badgeOk: { color: "#2f9e44" },
      spacer: { flex: "1 1 auto" },
      footer: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
      button: { border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", borderRadius: "8px", height: "32px", padding: "0 14px", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
      msg: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
      err: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-label-error)" },
      notice: { border: "1px dashed var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }
    };

    // jsx 辅助：children 统一成数组，key 作为第三参传入（动态列表需要）。
    function h(type, props, children, key) {
      const list = children === undefined ? undefined : (Array.isArray(children) ? children : [children]);
      return react_jsx_runtime.jsxs(type, list === undefined ? (props || {}) : { ...(props || {}), children: list }, key);
    }

    function JumpServerCard(props) {
      const face = props.jumpserverCard;
      // sources 每项：{ id, name, baseUrl, akRef, skRef, akConfigured, skConfigured,
      //   akDraft, skDraft, akFocus, skFocus, persisted }（草稿 + 状态）。
      const [sources, setSources] = react.useState([]);
      // stored：最近一次读回的权威基线（不含草稿），是「只提交本行」与脏判定的对照物。
      const [stored, setStored] = react.useState([]);
      const [defaultSource, setDefaultSource] = react.useState("");
      const [legacy, setLegacy] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      const [saved, setSaved] = react.useState(false);
      const [error, setError] = react.useState("");
      // 默认简体中文；仅当 GUI 明确选择英文时切换。
      const [lang, setLang] = react.useState("zh");
      // loaded：是否至少成功读取过一次。没有权威基线就开放写入，等于允许一张空列表
      // 覆盖掉全部已存源站，故读取失败期间一律不写。
      const [loaded, setLoaded] = react.useState(false);
      // revision：最近一次成功读取的配置版本，写入时回传以拒绝基于陈旧基线的整表覆盖。
      const [revision, setRevision] = react.useState(null);
      // 独立设置页默认展开；内嵌卡片仍默认收起。展开只影响本地阅读状态。
      const [open, setOpen] = react.useState(props.defaultOpen === true);
      // 凭证清理失败的提示（源站列表已更新，只是凭证库那一刀失败）。
      const [notes, setNotes] = react.useState([]);
      const T = STRINGS[lang] || STRINGS.zh;
      const storedById = new Map(stored.map((s) => [s.id, s]));
      // 生效默认源站：显式选择命中优先；否则唯一源站即默认（与服务端一致）。
      const effectiveDefault = (defaultSource && sources.some((s) => s.id === defaultSource))
        ? defaultSource
        : (sources.length === 1 ? sources[0].id : "");

      function messageOf(e) {
        const message = String(e && e.message ? e.message : e);
        return message === HOST_UNSUPPORTED ? T.hostTooOld : message;
      }

      function applyDescribed(r) {
        // 宿主不兼容优先于普通的不可信读取：给出升级指引，而不是误导性的“数据无法解析”。
        if (r && r.hostUnsupported) { setError(T.hostTooOld); return; }
        // 读取可信才替换基线并开放写入：unconfirmed（信封 ok 但载荷缺失/畸形）不是
        // 权威状态——拿它清空基线会让随后一次保存不带修订号地整表覆盖已存源站。
        if (r && r.unconfirmed) { setError(T.unconfirmedRead); return; }
        const described = (r && r.sources) || [];
        setSources(described.map((s) => ({ ...s, persisted: true, akDraft: "", skDraft: "", akFocus: false, skFocus: false })));
        setStored(described);
        setDefaultSource((r && r.defaultSource) || "");
        setRevision(Number.isInteger(r && r.revision) ? r.revision : null);
        setLegacy((r && r.legacy) || null);
        setLoaded(true);
      }

      react.useEffect(() => {
        let alive = true;
        face.describe().then((r) => { if (alive) applyDescribed(r); })
          // 读取失败必须可见；读取没成功就保持未就绪，此时任何保存都会用空基线覆盖已存源站。
          .catch((e) => { if (alive) setError(messageOf(e)); });
        return () => { alive = false; };
      }, [face]);

      // GUI 明确选择的语言优先；未选择、不支持或读取失败时保持默认简体中文。
      react.useEffect(() => {
        let alive = true;
        face.localePreference().then((p) => { if (alive) setLang(languageFor(p)); }).catch(() => {});
        return () => { alive = false; };
      }, [face]);

      function patchSource(id, patch) {
        setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      }

      function onAdd() {
        // 没有权威基线时不开放新增：保存只会把「只有这张新卡」的列表写回，抹掉已存源站。
        if (!loaded) { setError(T.notLoaded); return; }
        const id = generateSourceId();
        setSources((prev) => [...prev, { id, name: "", baseUrl: "", akRef: akRefForId(id), skRef: skRefForId(id), akConfigured: false, skConfigured: false, akDraft: "", skDraft: "", akFocus: false, skFocus: false, persisted: false }]);
      }

      // 导入旧版单源配置：沿用旧的凭证引用，不搬运也不重新输入密钥。
      function onImportLegacy() {
        if (!loaded || !legacy) return;
        const id = generateSourceId();
        setSources((prev) => [...prev, { id, name: DEFAULT_SOURCE_NAME, baseUrl: legacy.baseUrl || "", akRef: legacy.akRef, skRef: legacy.skRef, akConfigured: !!legacy.akConfigured, skConfigured: !!legacy.skConfigured, akDraft: "", skDraft: "", akFocus: false, skFocus: false, persisted: false }]);
      }

      async function reread(committedIds) {
        const r = await face.describe();
        if (r && r.unconfirmed) throw new Error(T.unconfirmedRead);
        const described = (r && r.sources) || [];
        setSources((prev) => mergeDrafts(described.map((s) => ({ ...s, persisted: true })), prev, committedIds));
        setStored(described);
        setDefaultSource((r && r.defaultSource) || "");
        setRevision(Number.isInteger(r && r.revision) ? r.revision : null);
        setLegacy((r && r.legacy) || null);
      }

      async function reload() {
        setSaving(true); setSaved(false); setError(""); setNotes([]);
        try { applyDescribed(await face.describe()); } catch (e) { setError(messageOf(e)); } finally { setSaving(false); }
      }

      // 「保存当前源站」：只提交本行。其它行以存储值原样带上（不动它们的草稿），
      // 本行用草稿值；新行追加到末尾。
      async function onSaveOne(id) {
        if (!loaded) { setError(T.notLoaded); return; }
        const draft = sources.find((s) => s.id === id);
        if (!draft) return;
        const row = storedRow({ ...draft, name: String(draft.name || "").trim(), baseUrl: String(draft.baseUrl || "").trim() });
        const nextSources = storedById.has(id)
          ? stored.map((s) => (s.id === id ? row : storedRow(s)))
          : [...stored.map(storedRow), row];
        const nextDefault = pickDefault(nextSources, defaultSource);
        const secrets = [];
        if (String(draft.akDraft || "").trim() !== "") secrets.push({ ref: row.akRef, value: String(draft.akDraft).trim() });
        if (String(draft.skDraft || "").trim() !== "") secrets.push({ ref: row.skRef, value: String(draft.skDraft).trim() });
        setSaving(true); setSaved(false); setError(""); setNotes([]);
        let rejected = false;
        const staged = [];
        try {
          // 先完成全部校验再开始任何写入，避免非法输入导致密钥已落库的半保存状态。
          validateSources(nextSources, T);
          for (const secret of secrets) {
            await face.setSecret(secret.ref, secret.value);
            // 新源站的密钥是本次新写入的：保存失败时可以回收；已有源站的是覆盖写，无法回滚。
            if (!storedById.has(id)) staged.push(secret.ref);
          }
          try {
            await face.writeSources(nextSources, nextDefault, revision);
          } catch (writeError) {
            // 只有宿主明确拒绝才算「确定没写入」，此时暂存的新密钥是孤儿凭证，可以回收；
            // 结果未知（RPC 断开等）时不能删——宿主可能已经提交。
            rejected = !!(writeError && writeError.remoteRejected);
            if (rejected) {
              for (const ref of staged) {
                try { await face.unsetSecret(ref); } catch (cleanupError) {
                  setNotes((prev) => [...prev, T.stagedCleanupFailed.replace("{ref}", ref) + messageOf(cleanupError)]);
                }
              }
            }
            throw writeError;
          }
          let readError = null;
          try { await reread(new Set([id])); } catch (e) { readError = e; await reread().catch(() => {}); }
          if (readError === null) setSaved(true); else setError(messageOf(readError));
        } catch (e) {
          setError(messageOf(e));
          // 基线可能已经前进（版本冲突、别处先写）：以服务端为准重读一次，草稿保留。
          await reread().catch(() => {});
        } finally {
          setSaving(false);
        }
      }

      // 移除即写：确认后立即从存储删除该源站并清除其专属凭证，不再等保存按钮。
      async function onRemove(id) {
        if (!loaded) { setError(T.notLoaded); return; }
        if (!window.confirm(T.confirmRemoveSource)) return;
        const target = sources.find((s) => s.id === id);
        if (!target) return;
        // 未保存的新行从未落库，直接丢草稿即可，无需远端写入。
        if (!storedById.has(id)) {
          setSources((prev) => prev.filter((s) => s.id !== id));
          return;
        }
        const nextSources = stored.filter((s) => s.id !== id).map(storedRow);
        const nextDefault = pickDefault(nextSources, defaultSource === id ? "" : defaultSource);
        setSaving(true); setSaved(false); setError(""); setNotes([]);
        try {
          await face.writeSources(nextSources, nextDefault, revision);
          // 配置已生效：清除该源站专属的凭证——前提是没有别的源站还在用同一个引用
          // （凭证只写不读，删掉就再也拿不回来）。清理失败只提示，不回滚已生效的移除。
          const inUse = new Set(nextSources.flatMap((s) => [s.akRef, s.skRef]));
          for (const ref of [target.akRef || akRefForId(id), target.skRef || skRefForId(id)]) {
            if (inUse.has(ref)) continue;
            try { await face.unsetSecret(ref); } catch (cleanupError) {
              setNotes((prev) => [...prev, T.cleanupFailed.replace("{name}", target.name).replace("{ref}", ref) + messageOf(cleanupError)]);
            }
          }
          setSources((prev) => prev.filter((s) => s.id !== id));
          setStored(nextSources);
          setDefaultSource(nextDefault);
          try { await reread(); setSaved(true); } catch (e) { setError(messageOf(e)); }
        } catch (e) {
          setError(messageOf(e));
          await reread().catch(() => {});
        } finally {
          setSaving(false);
        }
      }

      // 设为默认即写：只改 defaultSource，sources 以存储值原样回写（不动草稿）。
      async function onSetDefault(id) {
        if (!loaded) { setError(T.notLoaded); return; }
        if (!storedById.has(id)) return;
        setSaving(true); setSaved(false); setError(""); setNotes([]);
        try {
          await face.writeSources(stored.map(storedRow), id, revision);
          await reread();
          setSaved(true);
        } catch (e) {
          setError(messageOf(e));
          await reread().catch(() => {});
        } finally {
          setSaving(false);
        }
      }

      function secretField(s, kind) {
        const isAk = kind === "ak";
        const draft = isAk ? s.akDraft : s.skDraft;
        const focus = isAk ? s.akFocus : s.skFocus;
        const configured = isAk ? s.akConfigured : s.skConfigured;
        const value = configured && !focus && draft === "" ? MASK : draft;
        const draftKey = isAk ? "akDraft" : "skDraft";
        const focusKey = isAk ? "akFocus" : "skFocus";
        return h("div", { style: S.row }, [
          h("div", { style: S.head }, [
            h("label", { style: S.label }, isAk ? T.akLabel : T.skLabel),
            h("span", { style: { ...S.badge, ...(configured ? S.badgeOk : {}) } }, configured ? T.configured : T.notConfigured)
          ]),
          h("input", {
            type: "password",
            style: S.input,
            placeholder: isAk ? T.akPlaceholder : T.skPlaceholder,
            value,
            onFocus: () => patchSource(s.id, { [focusKey]: true }),
            onBlur: () => { if (draft === "") patchSource(s.id, { [focusKey]: false }); },
            onChange: (e) => {
              let v = e.target.value;
              if (v.startsWith(MASK)) v = v.slice(MASK.length);
              patchSource(s.id, { [draftKey]: v });
            }
          }),
          h("p", { style: S.hint }, configured ? T.hintConfigured : T.hintEmpty)
        ]);
      }

      function sourceCard(s) {
        const isStored = storedById.has(s.id);
        const dirty = rowDirty(s, storedById);
        const isDefault = isStored && s.id === effectiveDefault;
        return h("div", { style: S.source }, [
          h("div", { style: S.head }, [
            h("span", { style: S.label }, T.sourceNameLabel),
            isDefault ? h("span", { style: { ...S.badge, ...S.badgeOk } }, T.defaultBadge) : null,
            !isStored ? h("span", { style: S.badge }, T.unsavedBadge) : null,
            h("span", { style: S.spacer }),
            isStored && !isDefault ? h("button", { type: "button", style: S.button, disabled: saving, onClick: () => onSetDefault(s.id) }, T.setDefault) : null,
            h("button", { type: "button", style: S.button, disabled: saving, onClick: () => onRemove(s.id) }, T.removeSource)
          ]),
          h("input", { type: "text", style: S.input, placeholder: T.sourceNamePlaceholder, value: s.name, onChange: (e) => patchSource(s.id, { name: e.target.value }) }),
          h("p", { style: { ...S.hint, ...S.mono } }, T.uidLabel + "  " + s.id),
          h("div", { style: S.row }, [
            h("label", { style: S.label }, T.urlLabel),
            h("input", { type: "url", style: S.input, placeholder: T.urlPlaceholder, value: s.baseUrl, onChange: (e) => patchSource(s.id, { baseUrl: e.target.value }) }),
            h("p", { style: S.hint }, T.urlHint)
          ]),
          secretField(s, "ak"),
          secretField(s, "sk"),
          h("div", { style: S.footer }, [
            h("button", { type: "button", style: S.button, disabled: saving || !loaded || !dirty, onClick: () => onSaveOne(s.id) }, saving ? T.saving : T.saveCurrentSource)
          ])
        ], s.id);
      }

      const hasLegacyDraft = sources.some((s) => legacy && s.akRef === legacy.akRef && s.skRef === legacy.skRef);
      return h("section", { style: open ? { ...S.card, ...S.cardOpen } : S.card }, [
        h("button", { type: "button", style: S.header, "aria-expanded": open, onClick: () => setOpen(!open) }, [
          h("span", { style: S.headerText }, [
            h("span", { style: S.title }, T.title),
            h("span", { style: S.desc }, T.desc)
          ]),
          react_jsx_runtime.jsx("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", style: { ...S.chevron, transform: open ? "rotate(180deg)" : "none" }, children:
            react_jsx_runtime.jsx("path", { d: "M3.5 5.25 7 8.75 10.5 5.25", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })
          })
        ]),
        open ? h("div", { style: S.body }, [
          h("p", { style: S.heading }, T.sourcesHeading),
          h("p", { style: S.hint }, T.sourcesNote),
          loaded && legacy && !hasLegacyDraft ? h("div", { style: S.notice }, [
            h("span", { style: S.label }, T.importLegacyTitle),
            h("p", { style: S.hint }, T.importLegacyDesc),
            h("div", { style: S.footer }, [h("button", { type: "button", style: S.button, disabled: saving, onClick: onImportLegacy }, T.importLegacy)])
          ]) : null,
          loaded && sources.length === 0 && !legacy ? h("p", { style: S.hint }, T.sourcesEmpty) : null,
          ...sources.map(sourceCard),
          h("div", { style: S.footer }, [
            h("button", { type: "button", style: S.button, disabled: saving || !loaded, onClick: onAdd }, T.addSource),
            !loaded ? h("button", { type: "button", style: S.button, disabled: saving, onClick: reload }, T.reload) : null,
            saved ? h("p", { style: S.msg }, T.saved) : null,
            error ? h("p", { style: S.err }, error) : null
          ]),
          ...notes.map((note, i) => h("p", { style: S.err }, note, "note-" + i))
        ].filter((node) => node !== null)) : null
      ].filter((node) => node !== null));
    }

    // 宿主远端门面（dsh 0.1.2+）：settings / credentials 由 dsh-api-gateway 以
    // remote.<ns> 之名挂载。必须用 ctx.get 读而不是 ctx.remote.<ns>：未声明 inject 的
    // 点号访问会直接抛错，而 ctx.get 在服务缺席时只返回 undefined。
    function remoteNamespace(ctx, ns) {
      return typeof ctx.get === "function" ? ctx.get("remote." + ns) : undefined;
    }

    // remote.* 一律返回 { ok, value } 或 { ok:false, error:{ message } }。
    // 失败必须抛出可读信息：静默降级成空数据会把故障伪装成“没有配置”。
    // remoteRejected 区分两种失败：宿主明确拒绝（可以据此回收暂存凭证）与结果未知
    // （RPC 断开、传输异常——宿主可能已经提交，绝不能当成回滚信号）。
    function unwrap(res, what) {
      if (res && typeof res === "object" && res.ok === true) return res.value;
      const message = (res && typeof res === "object" && res.error && res.error.message) || (what + " failed");
      const error = new Error(message);
      if (res && typeof res === "object" && res.ok === false) error.remoteRejected = true;
      throw error;
    }

    function requireNamespace(ctx, ns) {
      const api = remoteNamespace(ctx, ns);
      if (!api) throw new Error(HOST_UNSUPPORTED);
      return api;
    }

    // settings.describe() 成功应答的 value 是聚合格 { writable, hasDocument, namespaces[] }。
    function settingsNamespacesOf(value) {
      const list = value && value.namespaces;
      return Array.isArray(list) ? list : [];
    }

    // 只接受形状完整的源站行；畸形行被丢弃时 describe 会标记 unconfirmed。
    function normalizeSource(raw) {
      if (!raw || typeof raw !== "object") return null;
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!id || !name) return null;
      return {
        id,
        name,
        baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
        akRef: typeof raw.akRef === "string" && raw.akRef ? raw.akRef : akRefForId(id),
        skRef: typeof raw.skRef === "string" && raw.skRef ? raw.skRef : skRefForId(id)
      };
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
      // 最近一次成功 describe 读到的配置版本。写入时即便调用方没有显式传版本，
      // 也按它做乐观并发检查——否则陈旧页面仍能把别的页面刚写进去的源站整批覆盖掉。
      let describedRevision = null;
      const face = {
        // sources + 各源站 AK/SK 是否已配置 + defaultSource + 旧版单源配置提示。
        // URL/名称存 settings（非 secret，返回明文）；密钥存凭证库（只返回 configured）。
        describe: async () => {
          const settings = remoteNamespace(ctx, "settings");
          if (!settings || !settings.describe) return { hostUnsupported: true, sources: [], defaultSource: "", unconfirmed: true };
          const described = unwrap(await settings.describe(), "settings.describe");
          const ns = settingsNamespacesOf(described).find((n) => n && n.ns === SETTINGS_NS);
          const rawValue = ns && ns.value;
          const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
          const rawSources = Array.isArray(value.sources) ? value.sources : null;
          const sources = rawSources === null ? [] : rawSources.map(normalizeSource).filter(Boolean);
          // 信封 ok 但载荷缺失/畸形（没有 namespaces、没有本插件命名空间、sources 不是
          // 数组、或有行被丢弃）：这不是宿主契约内的合法配置，经降级得到的空列表不是
          // 「权威的空配置」，不能用作写入基线。
          const unconfirmed = !Array.isArray(described && described.namespaces) || !ns || rawSources === null || sources.length !== rawSources.length;
          const revision = ns && Number.isInteger(ns.revision) ? ns.revision : null;
          describedRevision = revision;
          const legacyAk = typeof value.akRef === "string" && value.akRef ? value.akRef : LEGACY_AK_REF;
          const legacySk = typeof value.skRef === "string" && value.skRef ? value.skRef : LEGACY_SK_REF;
          const refs = Array.from(new Set([...sources.flatMap((s) => [s.akRef, s.skRef]), legacyAk, legacySk]));
          let creds = {};
          const credentials = remoteNamespace(ctx, "credentials");
          if (credentials && credentials.describe) {
            // describe(refs)：位置参数数组；value 直接就是 ref → { configured, writable } 的 record。
            creds = unwrap(await credentials.describe(refs), "credentials.describe") || {};
          }
          const configured = (ref) => Boolean(creds[ref] && creds[ref].configured);
          // 旧版单源配置还没进入 sources[]（启动迁移未执行或失败）：给出一键导入入口。
          const legacyUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
          const legacyPending = value.legacyMigrated !== true && sources.length === 0 && Boolean(legacyUrl || configured(legacyAk) || configured(legacySk));
          return {
            hostUnsupported: false,
            unconfirmed,
            sources: sources.map((s) => ({ ...s, akConfigured: configured(s.akRef), skConfigured: configured(s.skRef) })),
            defaultSource: typeof value.defaultSource === "string" ? value.defaultSource : "",
            legacy: legacyPending ? { baseUrl: legacyUrl, akRef: legacyAk, skRef: legacySk, akConfigured: configured(legacyAk), skConfigured: configured(legacySk) } : null,
            revision
          };
        },
        // 密钥走凭证库（仅写不读）：set(ref, value) / unset(ref)，均为位置参数。
        setSecret: async (ref, value) => unwrap(await requireNamespace(ctx, "credentials").set(ref, value), "credentials.set"),
        unsetSecret: async (ref) => unwrap(await requireNamespace(ctx, "credentials").unset(ref), "credentials.unset"),
        // 写入整个 sources 数组 + defaultSource。单次 mutate 多个 set op：set 对目标路径
        // 整体赋值（数组整体替换，不做按下标合并），所有 op 在宿主写队列的单个事务里一起
        // 应用、一起持久化——不会出现 sources 已清空而新值未落地的中间态。同时打上
        // legacyMigrated，之后旧版单源配置不再被当作隐式源站或再次迁移。
        // expectedRevision 回传最近一次 describe 读到的版本，真正挡住「陈旧页面覆盖新
        // 配置」。位置参数：mutate(ns, ops, expectedRevision?)。网关按声明参数个数严格
        // 校验 arity，第三参类型上可省但 arity 上不可省，故无版本时显式传 void 0。
        writeSources: async (rows, defaultSource, expectedRevision) => {
          const settings = requireNamespace(ctx, "settings");
          const normalized = rows.map((s) => ({
            id: s.id,
            name: s.name,
            baseUrl: s.baseUrl,
            akRef: s.akRef || akRefForId(s.id),
            skRef: s.skRef || skRefForId(s.id)
          }));
          unwrap(await settings.mutate(SETTINGS_NS, [
            { op: "set", path: ["sources"], value: normalized },
            { op: "set", path: ["defaultSource"], value: defaultSource },
            { op: "set", path: ["legacyMigrated"], value: true }
          ], Number.isInteger(expectedRevision) ? expectedRevision : (Number.isInteger(describedRevision) ? describedRevision : void 0)), "settings.mutate");
        },
        // 读取 GUI 的语言偏好（locale 命名空间的 preference 字段）；不可用时返回空串。
        // 语言只是外观，失败不值得报错打断卡片，故吸掉异常保留默认简体中文。
        localePreference: async () => {
          const settings = remoteNamespace(ctx, "settings");
          if (!settings || !settings.describe) return "";
          try {
            const described = unwrap(await settings.describe(), "settings.describe");
            const locale = settingsNamespacesOf(described).find((n) => n && n.ns === "locale");
            const pref = locale && locale.value && locale.value.preference;
            return typeof pref === "string" ? pref : "";
          } catch {
            return "";
          }
        }
      };

      registerSettingsEntry(ctx, face);
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
