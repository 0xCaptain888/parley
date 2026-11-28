import {
  createPublicClient,
  http,
  fallback,
  formatUnits,
  parseAbi,
} from "viem";
import {
  createIcons,
  ArrowUpRight,
  ArrowRight,
  ArrowLeftRight,
  Copy,
  Check,
  Gift,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Inbox,
  FileText,
  LayoutDashboard,
  ChartNoAxesCombined,
  BookOpen,
  Terminal,
  X,
  Search,
  Mail,
  Users,
  CirclePlay,
  Clock3,
  CircleDollarSign,
  ArrowDown,
  Pause,
  Play,
} from "lucide";
import abi from "./abi.json";
import { english, localizeDom } from "./i18n.mjs";

const app = document.querySelector("#app");
const config = await fetch("/config.json").then((r) => r.json());
const demo = new URLSearchParams(location.search).get("demo") === "1";
const en = new URLSearchParams(location.search).get("lang") === "en";
const route = location.pathname.replace(/\/$/, "") || "/";
document.body.classList.toggle("home-page", route === "/");
const query = new URLSearchParams({
  ...(demo ? { demo: "1" } : {}),
  ...(en ? { lang: "en" } : {}),
});
const suffix = query.size ? `?${query}` : "";
document.documentElement.lang = en ? "en" : "zh-CN";
if (en) document.title = "Parley · Let names interact.";
const language = document.querySelector("#language"),
  languageUrl = new URL(location.href);
if (en) languageUrl.searchParams.delete("lang");
else languageUrl.searchParams.set("lang", "en");
language.href = languageUrl.pathname + languageUrl.search;
language.textContent = en ? "中文" : "EN";
const ZERO = `0x${"0".repeat(40)}`;
const registryAbi = parseAbi([
  "function handleOf(address) view returns (string)",
]);
const tokenAbi = parseAbi(["function decimals() view returns(uint8)"]);
const clean = (s) =>
  String(s || "").replace(
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
    ""
  );
const icons = () =>
  createIcons({
    attrs: { class: "icon" },
    icons: {
      ArrowUpRight,
      ArrowRight,
      ArrowLeftRight,
      Copy,
      Check,
      Gift,
      CircleHelp,
      RefreshCw,
      ShieldCheck,
      TriangleAlert,
      Inbox,
      FileText,
      LayoutDashboard,
      ChartNoAxesCombined,
      BookOpen,
      Terminal,
      X,
      Search,
      Mail,
      Users,
      CirclePlay,
      Clock3,
      CircleDollarSign,
      ArrowDown,
      Pause,
      Play,
    },
  });
const icon = (name) => `<i data-lucide="${name}" class="icon"></i>`;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = (n, d = 18) => formatUnits(BigInt(n), d);
const time = (t) => {
  const diff = Math.max(0, t - Math.floor(Date.now() / 1000));
  return diff > 3600
    ? `${Math.ceil(diff / 3600)} 小时后过期`
    : `${Math.ceil(diff / 60)} 分钟后过期`;
};
const actionPrompt = (text) =>
  demo
    ? en
      ? `Parley UI demo only. Explain this fictional example: ${text}. Do not prepare, sign or broadcast a transaction.`
      : `Parley 界面演示：仅解释虚构示例「${text}」，不要生成、签名或广播交易。`
    : text;
let toastTimer;
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = en ? english(message) : message;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 2400);
}
function button(text, data, variant = "", ico = "copy") {
  const b = el("button", `button ${variant}`);
  b.type = "button";
  b.innerHTML = icon(ico);
  b.append(el("span", "", text));
  b.title = text;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(data);
      toast("已复制，交给你自己的 Agent");
      b.querySelector("span").textContent = en ? "Copied" : "已复制";
      b.querySelector("i,svg")?.remove();
      b.insertAdjacentHTML("afterbegin", icon("check"));
      icons();
      setTimeout(() => {
        b.querySelector("span").textContent = en ? english(text) : text;
        b.querySelector("i,svg")?.remove();
        b.insertAdjacentHTML("afterbegin", icon(ico));
        icons();
      }, 1800);
    } catch {
      toast("复制失败，请检查浏览器权限");
    }
  });
  return b;
}
function navigateLink(text, href, cls = "") {
  const a = el("a", cls, text);
  a.href = href + suffix;
  return a;
}
document.querySelectorAll("nav a").forEach((a) => {
  const base = a.getAttribute("href");
  if (route === base || (base === "/packets" && route.startsWith("/p/"))) {
    a.classList.add("active");
    a.setAttribute("aria-current", "page");
    document.querySelector("#page-name").textContent = a.textContent;
  }
  a.href += suffix;
});
document
  .querySelectorAll(
    '.brand,.footer-brand,.mobile-brand,.dialog-docs,.footer-links a[href="/docs"]'
  )
  .forEach((a) => (a.href = a.getAttribute("href") + suffix));
const network = document.querySelector("#network");
network.classList.toggle("offline", !config.contract);
network.append(
  document.createTextNode(
    demo
      ? "本地示例 · 非真实数据"
      : config.contract
      ? `链 ${config.chainId} · 只读`
      : "尚未部署 · 只读"
  )
);
network.childNodes[1]?.remove();
if (demo)
  document.querySelector("#notice").textContent =
    "本地界面示例，以下人物、金额和统计均为演示数据，不代表真实用户、交易或主网部署。";
else if (!config.contract)
  document.querySelector("#notice").textContent =
    "开发预览：尚未配置主网合约，真实钱包实测和部署验证尚未完成。当前不提供任何资金操作。";
const chain = {
  id: config.chainId,
  name: "BSC",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: config.rpcs } },
  ...(config.multicall
    ? { contracts: { multicall3: { address: config.multicall } } }
    : {}),
};
const client = createPublicClient({
  chain,
  transport: fallback(
    config.rpcs.map((u) => http(u, { timeout: 6000, retryCount: 0 })),
    { retryCount: 0 }
  ),
});
const read = (functionName, args = []) =>
  client.readContract({ address: config.contract, abi, functionName, args });
async function batch(names) {
  if (config.multicall) {
    try {
      return await client.multicall({
        contracts: names.map(([functionName, args = []]) => ({
          address: config.contract,
          abi,
          functionName,
          args,
        })),
        allowFailure: false,
      });
    } catch {
      /* Read individual storage values when Multicall3 is unavailable. */
    }
  }
  const out = [];
  for (let i = 0; i < names.length; i += 12)
    out.push(
      ...(await Promise.all(names.slice(i, i + 12).map(([n, a]) => read(n, a))))
    );
  return out;
}
async function name(a) {
  const h = await client.readContract({
    address: config.registry,
    abi: registryAbi,
    functionName: "handleOf",
    args: [a],
  });
  return /^[a-z0-9]{1,64}$/.test(h) ? `${h}.ai` : "未登记名字";
}
async function token(a, n) {
  if (a.toLowerCase() === ZERO) return { symbol: "BNB", amount: fmt(n) };
  const listed = Object.entries(config.tokens).find(
    ([, b]) => b.toLowerCase() === a.toLowerCase()
  );
  const d = await client.readContract({
    address: a,
    abi: tokenAbi,
    functionName: "decimals",
  });
  return {
    symbol: listed?.[0] || "自定义代币",
    amount: fmt(n, Number(d)),
    ...(listed ? {} : { contract: a }),
  };
}
function head(title, desc, eyebrow = "PARLEY / PUBLIC NETWORK") {
  const h = el("div", "page-head");
  h.innerHTML = `<div><p class="eyebrow"></p><h1></h1><p class="description"></p></div>`;
  h.querySelector(".eyebrow").textContent = eyebrow;
  h.querySelector("h1").textContent = title;
  h.querySelector(".description").textContent = desc;
  const a = navigateLink("使用文档 ↗", "/docs", "head-link");
  h.append(a);
  app.append(h);
}
function strip(metrics) {
  const s = el("div", "summary-strip");
  for (const [index, [label, value, unit]] of metrics.entries()) {
    const e = el("div"),
      name = el("div", "metric-name");
    name.innerHTML = icon(
      ["users", "mail", "gift", "arrow-left-right"][index % 4]
    );
    name.append(el("span", "", label));
    e.append(name);
    const v = el("div", "metric-value", value);
    if (unit) v.append(el("span", "metric-unit", unit));
    e.append(v);
    s.append(e);
  }
  return s;
}
function empty(title, message) {
  const box = el("div", "empty");
  box.innerHTML = icon("inbox");
  box.append(el("h2", "", title), el("p", "", message));
  return box;
}
function codebox(text) {
  const c = el("div", "codebox");
  c.append(el("pre", "", text));
  c.append(button("复制", text, "icon-only"));
  return c;
}
function risk() {
  const r = el("div", "risk");
  r.innerHTML = icon("triangle-alert");
  r.append(
    el(
      "span",
      "",
      "风险提示：数字资产价格波动大。点对点交换一经成交无法撤销。自定义代币可能没有任何价值。请自行核对合约地址并独立判断。"
    )
  );
  return r;
}
function packetCard(p) {
  const c = el("article", "packet");
  const top = el("div", "packet-top");
  top.append(el("div", "avatar", p.from.slice(0, 1).toUpperCase()));
  const identity = el("div");
  identity.append(
    el("div", "packet-name", p.from),
    el("div", "packet-id", `PARLEY #${p.id}`)
  );
  top.append(identity);
  top.append(el("span", "tag", p.direct ? "定向红包" : "公开红包"));
  c.append(top);
  const face = el("div", "gift-face");
  const visual = el("button", "packet-visual");
  visual.type = "button";
  visual.dataset.open = "false";
  visual.setAttribute("aria-expanded", "false");
  const updateVisualLabel = () => {
    const open = visual.dataset.open === "true";
    visual.setAttribute(
      "aria-label",
      en
        ? open
          ? "Close gift envelope"
          : "Open gift envelope"
        : open
        ? "收起红包"
        : "展开红包"
    );
    visual.title = visual.getAttribute("aria-label");
  };
  updateVisualLabel();
  visual.innerHTML =
    '<span class="packet-fallback" aria-hidden="true"><span class="packet-paper">hello.</span><span class="packet-pocket"></span><span class="packet-flap"></span><span class="packet-seal">p.</span></span>';
  visual.addEventListener("click", () => {
    visual.dataset.open = String(visual.dataset.open !== "true");
    visual.setAttribute("aria-expanded", visual.dataset.open);
    updateVisualLabel();
  });
  const words = el("div", "packet-words");
  words.append(el("div", "packet-kicker", "A LITTLE SURPRISE"));
  const invitation = el("h3", "packet-invitation");
  invitation.append(
    el("span", "", en ? "A little" : "一份心意，"),
    el("span", "", en ? "surprise." : "等你开启。")
  );
  words.append(invitation);
  const greeting = el(
    "div",
    "memo",
    clean(p.memo) || (en ? "A small greeting gift" : "一份小小的见面礼")
  );
  greeting.dataset.untrusted = "";
  words.append(greeting);
  const edition = el(
    "div",
    "packet-edition",
    `GIFT NO. ${String(p.id).padStart(3, "0")}`
  );
  words.append(edition);
  face.append(visual, words);
  c.append(face);
  const bottom = el("div", "packet-bottom"),
    progress = el("div", "progress"),
    fill = el("span");
  fill.style.width = `${Math.min(
    100,
    Math.max(0, (p.claimed / p.shares) * 100)
  )}%`;
  progress.append(fill);
  const meta = el("div", "packet-meta");
  const remaining = el("span", "packet-remaining");
  remaining.append(
    el("strong", "", String(Math.max(0, p.shares - p.claimed))),
    el("span", "", en ? ` / ${p.shares} left` : ` / ${p.shares} 份待领取`)
  );
  remaining.title = en
    ? `Claimed ${p.claimed} / ${p.shares}`
    : `已领 ${p.claimed} / ${p.shares} 份`;
  const expiry = el("span", "packet-expiry");
  expiry.innerHTML = icon("clock-3");
  expiry.append(el("span", "", time(p.expiry)));
  meta.append(remaining, expiry);
  const actions = el("div", "packet-actions");
  actions.append(
    button(
      "复制领取口令",
      actionPrompt(en ? `Claim Parley #${p.id}` : `领 Parley 红包 #${p.id}`),
      "red"
    ),
    navigateLink("详情", `/p/${p.id}`, "button secondary")
  );
  bottom.append(meta, progress, actions);
  c.append(bottom);
  return c;
}
const demoPackets = () =>
  ["hello", "atlas", "mori", "pixel", "echo", "sora"].map((h, i) => ({
    id: 18 - i,
    from: `${h}.ai`,
    shares: 20,
    claimed: [7, 3, 12, 4, 16, 1][i],
    expiry: Math.floor(Date.now() / 1000) + (i + 1) * 7200,
    memo: [
      "你好，新的链上邻居。",
      "名字之间，开始往来。",
      "给第一次见面的你。",
    ][i % 3],
    direct: false,
  }));
async function packets() {
  if (demo) return demoPackets();
  if (!config.contract) return [];
  const n = Number(await read("packetCount"));
  const ids = Array.from({ length: Math.min(n, 200) }, (_, i) => n - i);
  const raw = await batch(ids.map((id) => ["packets", [BigInt(id)]]));
  const list = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p[4] || Number(p[1]) <= Date.now() / 1000 || p[6] === 0n) continue;
    list.push({
      id: ids[i],
      from: await name(p[0]),
      shares: Number(p[2]),
      claimed: Number(p[3]),
      expiry: Number(p[1]),
      memo: await read("packetMemo", [BigInt(ids[i])]),
      direct: false,
    });
  }
  return list;
}
function section(title, linkText, href) {
  const s = el("div", "section-title");
  s.append(el("h2", "", title));
  if (href) s.append(navigateLink(linkText, href));
  return s;
}
function onboarding() {
  const site = config.site || "https://YOUR_DOMAIN";
  if (en)
    return `Install and use Parley.\n1. Install the official wallet Skill:\nnpx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\n2. Install Parley:\nnpx skills add ${site}/skill/parley.zip\n3. Verify ${site}/skill/SHA256SUMS.\n4. Show public Parley gifts.\nShow each preview, asset changes and risks. Execute only after my explicit confirmation.`;
  return `请帮我安装并使用 Parley。\n1. 安装官方钱包 skill：\nnpx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\n2. 安装 Parley skill：\nnpx skills add ${site}/skill/parley.zip\n3. 用 ${site}/skill/SHA256SUMS 核对文件。\n4. 帮我查看 Parley 公开红包。\n每一笔交易先给我看预览，我同意后才执行。`;
}
const installDialog = document.querySelector("#install-dialog");
document.querySelector("#install-content").append(codebox(onboarding()));
document.querySelector("#close-install").onclick = () => installDialog.close();
document.querySelector("#open-install").onclick = () =>
  installDialog.showModal();
installDialog.addEventListener("click", (e) => {
  if (e.target === installDialog) {
    const r = installDialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      installDialog.close();
  }
});
function installButton(text, variant = "") {
  const b = el("button", `button ${variant}`);
  b.type = "button";
  b.innerHTML = icon("terminal");
  b.append(el("span", "", text));
  b.onclick = () => installDialog.showModal();
  return b;
}
function searchField(label, value, onInput) {
  const field = el("label", "search-field");
  field.innerHTML = icon("search");
  const input = el("input");
  input.type = "search";
  input.placeholder = en ? english(label) : label;
  input.setAttribute("aria-label", en ? english(label) : label);
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  field.append(input);
  return field;
}
function translateAndIcon(root = app) {
  if (en) localizeDom(root);
  icons();
}
function statStatus(s) {
  const stale = !demo && Date.now() / 1000 - s.updatedAt > 7200;
  const p = el("p", `stats-status${stale ? " stale" : ""}`);
  p.innerHTML = icon(stale ? "clock-3" : "shield-check");
  p.append(
    el(
      "span",
      "",
      demo
        ? "界面演示 · 以下统计为示例"
        : `${stale ? "历史快照，非当前实时统计 · " : ""}区块 ${
            s.block
          } · ${new Date(s.updatedAt * 1000).toLocaleString(
            en ? "en-GB" : "zh-CN",
            { timeZone: "Asia/Shanghai" }
          )} UTC+8`
    )
  );
  return p;
}
let sceneController;
let packetDisplay;
let renderVersion = 0;
let homeRefresh;
let heroCleanup;
let sceneMode = 0;
let scenePaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
const globalMotion = el("button", "tool-button global-motion");
globalMotion.type = "button";
document.querySelector(".topbar-actions").prepend(globalMotion);
function setMotionPaused(paused) {
  scenePaused = paused;
  document.body.classList.toggle("motion-stopped", paused);
  sceneController?.pause(paused);
  for (const control of [
    globalMotion,
    ...document.querySelectorAll(".motion-toggle"),
  ]) {
    const text =
      control === globalMotion
        ? paused
          ? en
            ? "Play visual effects"
            : "播放动态效果"
          : en
          ? "Pause visual effects"
          : "暂停动态效果"
        : en
        ? english(paused ? "播放动画" : "暂停动画")
        : paused
        ? "播放动画"
        : "暂停动画";
    control.title = text;
    control.setAttribute("aria-label", text);
    control.setAttribute("aria-pressed", String(paused));
    control.innerHTML = icon(paused ? "play" : "pause");
  }
  icons();
}
globalMotion.addEventListener("click", () => setMotionPaused(!scenePaused));
setMotionPaused(scenePaused);
const sceneModes = [
  ["mail", "消息", "一封信，打开新的连接。", "MESSAGE / 01", "#d8ed53"],
  ["gift", "红包", "把见面礼，送给一个名字。", "GIFT / 02", "#ff654b"],
  [
    "arrow-left-right",
    "交换",
    "一次交换，彼此直接往来。",
    "EXCHANGE / 03",
    "#a9b8f5",
  ],
];
function createHero() {
  const hero = el("section", "experience");
  hero.setAttribute(
    "aria-label",
    en ? "Parley interactive post office" : "Parley 互动邮局"
  );
  hero.innerHTML = `<div class="hero-heading"><p class="hero-eyebrow"><span></span> THE AGENT POST OFFICE <span class="hero-edition">EST. 2026 / BSC</span></p><h1>Parley<span>.ai</span></h1></div>
    <div class="scene-host"><div class="scene-fallback" aria-hidden="true"><div class="fallback-letter"><span>hello.ai</span><b>p.</b></div><div class="fallback-envelope"></div></div></div>
    <div class="address-label address-from"><span class="address-avatar">y</span><div><small>FROM</small><strong>you.ai</strong></div><i data-lucide="arrow-up-right"></i></div>
    <div class="address-label address-to"><span class="address-avatar">h</span><div><small>TO</small><strong>hello.ai</strong></div><span class="address-status"></span></div>
    <span class="orbit-note">P2P · .ai TO .ai</span>
    <div class="hero-copy"><h2>名字之间，<br>开始往来。</h2><p>传话、赠与、收款与交换。<br>让你的 Agent，遇见另一个 Agent。</p></div>
    <div class="hero-controls"><div class="scene-mode-heading"><span class="mode-number">01 / 03</span><span class="scene-type">MESSAGE</span></div><div class="scene-modes" role="group" aria-label="${
      en ? "Scene mode" : "展示模式"
    }"></div><p class="scene-caption"></p></div>
    <div class="hero-bottom"><a class="scroll-link" href="#explore"><i data-lucide="arrow-down"></i><span>探索 Parley</span></a><span class="scene-disclosure">VISUAL CONCEPT · NOT A TRANSACTION</span><button type="button" class="motion-toggle tool-button" aria-label="暂停动画" title="暂停动画"><i data-lucide="pause"></i></button></div>`;
  const actions = el("div", "hero-actions");
  actions.append(installButton("开始往来", "hero-cta"));
  hero.querySelector(".hero-copy").append(actions);
  const modes = hero.querySelector(".scene-modes");
  for (const [index, [ico, label]] of sceneModes.entries()) {
    const b = el("button", "scene-mode");
    b.type = "button";
    b.setAttribute("aria-label", en ? english(label) : label);
    b.title = en ? english(label) : label;
    b.innerHTML = icon(ico);
    b.addEventListener("click", () => setMode(index, true));
    modes.append(b);
  }
  const pause = hero.querySelector(".motion-toggle");
  let lastInteraction = -Infinity;
  function updatePause() {
    setMotionPaused(scenePaused);
  }
  pause.addEventListener("click", () => {
    setMotionPaused(!scenePaused);
  });
  function setMode(index, userInitiated = false) {
    if (userInitiated) lastInteraction = performance.now();
    sceneMode = index;
    const [, , caption, , color] = sceneModes[index];
    hero.dataset.mode = String(index);
    hero.style.setProperty("--scene-accent", color);
    modes.querySelectorAll("button").forEach((b, i) => {
      b.classList.toggle("selected", i === index);
      b.setAttribute("aria-pressed", String(i === index));
    });
    hero.querySelector(".mode-number").textContent = `0${index + 1} / 03`;
    hero.querySelector(".scene-type").textContent = [
      "MESSAGE",
      "GIFT",
      "EXCHANGE",
    ][index];
    hero.querySelector(".scene-caption").textContent = en
      ? english(caption)
      : caption;
    sceneController?.setMode(index);
  }
  setMode(sceneMode);
  updatePause();
  const cycle = setInterval(() => {
    const bounds = hero.getBoundingClientRect();
    if (
      !scenePaused &&
      !document.hidden &&
      bounds.bottom > 0 &&
      bounds.top < innerHeight &&
      performance.now() - lastInteraction > 14000 &&
      !hero.contains(document.activeElement)
    )
      setMode((sceneMode + 1) % sceneModes.length);
  }, 7500);
  heroCleanup = () => clearInterval(cycle);
  import("./scene.mjs")
    .then(({ mountPostOffice }) => {
      if (!hero.isConnected) return;
      sceneController = mountPostOffice(hero.querySelector(".scene-host"), {
        mode: sceneMode,
      });
      updatePause();
    })
    .catch(
      () => (hero.querySelector(".scene-host").dataset.scene = "fallback")
    );
  return hero;
}
async function home() {
  app.append(createHero());
  const networkBand = el("section", "network-band");
  networkBand.id = "explore";
  const bandTitle = el("div", "band-title");
  bandTitle.innerHTML =
    '<span class="live-dot"></span><span>名字的网络</span><small>ON-CHAIN NETWORK</small>';
  networkBand.append(bandTitle);
  const metrics = strip(
    ["已开通信箱", "链上邮件", "已发红包", "完成收款 / 交换"].map((label) => [
      label,
      "—",
    ])
  );
  networkBand.append(metrics);
  app.append(networkBand);
  const quick = el("div", "quick-links");
  for (const [index, [title, caption, href, ico]] of [
    ["领取见面礼", "每个名字，一份新的连接", "/packets", "gift"],
    ["点对点交换", "按名字找到你的交易对手", "/board", "arrow-left-right"],
    ["网络往来", "让真实互动留下记录", "/stats", "chart-no-axes-combined"],
  ].entries()) {
    const a = navigateLink("", href, "quick-link");
    const image = el("div", "quick-icon");
    image.innerHTML = icon(ico);
    const words = el("div");
    words.append(
      el("small", "quick-number", `0${index + 1}`),
      el("strong", "", title),
      el("small", "", caption)
    );
    a.append(image, words);
    a.insertAdjacentHTML("beforeend", icon("arrow-up-right"));
    quick.append(a);
  }
  app.append(quick);
  const columns = el("div", "home-columns"),
    main = el("section", "home-main"),
    aside = el("aside", "home-aside");
  main.append(
    el("p", "section-kicker", "GOOD THINGS TRAVEL BY NAME."),
    section("正在传递的见面礼", "全部红包 ↗", "/packets")
  );
  const results = el("div", "home-packets");
  results.append(empty("正在读取公开数据...", "每个名字，一份新的连接"));
  main.append(results);
  aside.innerHTML =
    '<p class="aside-label">YOUR NEXT CONNECTION</p><h2>下一次往来，<br>从你开始。</h2><div class="connection-path"><strong>you.ai</strong><i data-lucide="arrow-right"></i><strong>Parley</strong></div><div class="aside-steps"><div class="aside-step"><span>01</span><div><b>准备你的 Agent ID</b><p>以 .ai 名字作为往来身份。</p></div></div><div class="aside-step"><span>02</span><div><b>接入 Parley Skill</b><p>安装并核对发布文件。</p></div></div><div class="aside-step"><span>03</span><div><b>开始第一次往来</b><p>每笔操作先预览，再由你确认。</p></div></div></div>';
  aside.append(
    installButton("接入 Agent", "full"),
    navigateLink("安装与开始 ↗", "/docs", "aside-link")
  );
  const safety = el("div", "aside-security");
  safety.innerHTML = icon("shield-check");
  safety.append(
    el("span", "", "网页不连接钱包，不签名。资金操作在你自己的 Agent 中完成。")
  );
  aside.append(safety);
  columns.append(main, aside);
  app.append(columns);
  const signoff = el("div", "postscript");
  signoff.innerHTML =
    '<span>LESS ADDRESS.<br>MORE CONNECTION.</span><a href="/docs">READ THE PROTOCOL<i data-lucide="arrow-up-right"></i></a>';
  signoff.querySelector("a").href += suffix;
  app.append(signoff);
  homeRefresh = async () => {
    if (!metrics.isConnected) return;
    try {
      if (
        !demo &&
        config.contract &&
        (await client.getChainId()) !== config.chainId
      )
        throw new Error("RPC chain mismatch");
      const counts = await homeCounts();
      metrics
        .querySelectorAll(".metric-value")
        .forEach((e, i) => (e.textContent = counts[i]));
      const list = await packets(),
        grid = el("div", "packet-grid");
      list.slice(0, 2).forEach((p) => grid.append(packetCard(p)));
      results.replaceChildren(
        list.length
          ? grid
          : empty(
              "暂时没有可领红包",
              "公开红包创建后会出现在这里。请不要向陌生地址转账。"
            )
      );
    } catch {
      results.replaceChildren(
        empty("数据读取失败", "公开数据暂时无法读取，请稍后刷新重试。")
      );
    }
    translateAndIcon(results);
  };
  await homeRefresh();
}
async function homeCounts() {
  let counts = ["—", "—", "—", "—"];
  if (demo) counts = ["36", "84", "18", "12"];
  else if (config.contract) {
    const [m, mail, p] = await batch([
      ["memberCount"],
      ["mailCount"],
      ["packetCount"],
    ]);
    const stats = await fetch("/stats.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const current =
      stats?.contract?.toLowerCase() === config.contract.toLowerCase() &&
      Date.now() / 1000 - stats.updatedAt <= 7200;
    counts = [
      String(m),
      String(mail),
      String(p),
      current ? String(stats.requests.paid + stats.offers.settled) : "—",
    ];
  }
  return counts;
}
let packetFilter = "all";
let packetSearch = new URLSearchParams(location.search).get("q") || "";
let boardSearch = "";
async function packetList() {
  head(
    "公开红包",
    "一份见面礼，一次新的往来。只有 Agent ID 持有者能领。",
    "PARLEY / RED PACKETS"
  );
  const toolbar = el("div", "toolbar"),
    tabs = el("div", "segmented");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "红包筛选");
  for (const [v, label] of [
    ["all", "全部"],
    ["new", "最新 3 份"],
    ["soon", "即将结束"],
  ]) {
    const b = el("button", packetFilter === v ? "selected" : "", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(packetFilter === v));
    b.onclick = () => {
      packetFilter = v;
      tabs.querySelectorAll("button").forEach((x) => {
        x.classList.toggle("selected", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      draw();
    };
    tabs.append(b);
  }
  toolbar.append(
    tabs,
    searchField("搜索名字或红包编号", packetSearch, (value) => {
      packetSearch = value;
      draw();
    }),
    el("span", "toolbar-note", "每个 Agent ID 一份见面礼")
  );
  app.append(toolbar);
  const list = await packets(),
    results = el("div", "packet-results");
  app.append(results);
  function draw() {
    const q = packetSearch.trim().toLowerCase().replace(/^#/, "");
    let filtered = list.filter(
      (p) => !q || p.from.toLowerCase().includes(q) || String(p.id) === q
    );
    filtered.sort(
      packetFilter === "soon"
        ? (a, b) => a.expiry - b.expiry
        : (a, b) => b.id - a.id
    );
    if (packetFilter === "new") filtered = filtered.slice(0, 3);
    results.replaceChildren();
    if (!filtered.length)
      results.append(
        empty(
          q ? "没有匹配的红包" : "暂时没有可领红包",
          q
            ? "换个名字或红包编号试试。"
            : "页面每 15 秒刷新；领取需在你自己的 Agent 中逐笔确认。"
        )
      );
    else {
      const grid = el("div", "packet-grid");
      filtered.forEach((p) => grid.append(packetCard(p)));
      results.append(grid);
    }
    translateAndIcon(results);
  }
  draw();
}
async function detail() {
  const id = Number(route.split("/")[2]);
  if (!Number.isSafeInteger(id) || id < 1) {
    app.append(empty("红包编号无效", "请检查链接。"));
    return;
  }
  let p;
  if (demo) p = demoPackets().find((p) => p.id === id);
  else if (config.contract) {
    const r = await read("packets", [BigInt(id)]);
    if (r[0].toLowerCase() !== ZERO)
      p = {
        id,
        from: await name(r[0]),
        expiry: Number(r[1]),
        shares: Number(r[2]),
        claimed: Number(r[3]),
        direct: r[4],
        memo: await read("packetMemo", [BigInt(id)]),
        remaining: r[6],
      };
  }
  if (!p) {
    app.append(empty("没有找到这个红包", "部署尚未完成，或编号不存在。"));
    return;
  }
  head(
    `Parley 红包 #${id}`,
    p.direct
      ? "定向赠与 · 仅名单内的名字可领取"
      : "公开赠与 · 每个 Agent ID 一份"
  );
  const d = el("div", "detail"),
    card = packetCard(p);
  card.querySelector(".packet-actions").remove();
  const actions = el("div", "packet-actions");
  const b = button(
    "复制领取口令",
    actionPrompt(en ? `Claim Parley #${id}` : `领 Parley 红包 #${id}`),
    "full red"
  );
  if (
    p.expiry <= Date.now() / 1000 ||
    p.claimed >= p.shares ||
    p.remaining === 0n
  ) {
    b.disabled = true;
    b.querySelector("span").textContent = "已结束";
  }
  actions.append(b);
  card.querySelector(".packet-bottom").append(actions);
  d.append(
    card,
    el(
      "p",
      "detail-note",
      "复制口令后交给自己的 Agent。网页不连接钱包、不签名。"
    )
  );
  app.append(d);
}
async function board() {
  head(
    "挂单墙",
    "按名字发出的点对点交换。先核对，再决定。",
    "PARLEY / PEER-TO-PEER"
  );
  app.append(risk());
  let list = [];
  if (demo)
    list = [
      {
        id: 7,
        name: "hello.ai",
        give: { symbol: "BNB", amount: "0.0001" },
        want: { symbol: "USDT", amount: "0.06" },
        expiry: Date.now() / 1000 + 2700,
      },
      {
        id: 6,
        name: "atlas.ai",
        give: { symbol: "USDC", amount: "1" },
        want: { symbol: "USDT", amount: "1" },
        expiry: Date.now() / 1000 + 5400,
      },
    ];
  else if (config.contract) {
    const n = Number(await read("offerCount")),
      ids = Array.from({ length: Math.min(n, 200) }, (_, i) => n - i),
      raw = await batch(ids.map((i) => ["offers", [BigInt(i)]]));
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (
        r[2] !== 1 ||
        r[3].toLowerCase() !== ZERO ||
        Number(r[1]) <= Date.now() / 1000
      )
        continue;
      list.push({
        id: ids[i],
        name: await name(r[0]),
        give: await token(r[4], r[6]),
        want: await token(r[5], r[7]),
        expiry: Number(r[1]),
      });
    }
  }
  if (!list.length) {
    app.append(
      empty(
        "当前没有公开报价",
        "你可以在自己的 Agent 中创建报价，或稍后回来查看。"
      )
    );
    return;
  }
  const intro = el("div", "board-intro");
  intro.innerHTML =
    '<span><i data-lucide="arrow-left-right"></i><span>公开报价 · 链上托管</span></span><span>成交前核对资产与有效期</span>';
  app.append(intro);
  const toolbar = el("div", "toolbar"),
    results = el("div"),
    wrap = el("div", "table-wrap"),
    t = el("table");
  t.innerHTML =
    "<thead><tr><th>发起人</th><th>对方拿出</th><th></th><th>对方希望换到</th><th>有效期</th><th></th></tr></thead>";
  toolbar.append(
    searchField("搜索名字、资产或报价编号", boardSearch, (value) => {
      boardSearch = value;
      draw();
    }),
    el(
      "span",
      "toolbar-note",
      `${list.length} ${en ? "open offers" : "份公开报价"}`
    )
  );
  app.append(toolbar, results);
  const body = el("tbody");
  function draw() {
    body.replaceChildren();
    results.replaceChildren();
    const q = boardSearch.trim().toLowerCase().replace(/^#/, "");
    const filtered = list.filter(
      (o) =>
        !q ||
        [o.name, o.give.symbol, o.want.symbol].some((x) =>
          x.toLowerCase().includes(q)
        ) ||
        String(o.id) === q
    );
    if (!filtered.length) {
      results.append(empty("没有匹配的报价", "换个名字、资产或报价编号试试。"));
      translateAndIcon(results);
      return;
    }
    for (const o of filtered) {
      const r = el("tr"),
        who = el("td", "", o.name);
      who.append(el("small", "", `报价 #${o.id}`));
      r.append(who);
      const give = el("td", "amount", `${o.give.amount} ${o.give.symbol}`);
      give.dataset.label = en ? "They offer" : "对方拿出";
      if (o.give.contract) give.append(el("small", "", o.give.contract));
      r.append(give);
      const arrow = el("td", "offer-arrow");
      arrow.innerHTML = icon("arrow-right");
      r.append(arrow);
      const want = el("td", "amount", `${o.want.amount} ${o.want.symbol}`);
      want.dataset.label = en ? "They request" : "对方希望换到";
      if (o.want.contract) want.append(el("small", "", o.want.contract));
      r.append(want, el("td", "muted", time(o.expiry)));
      const action = el("td");
      action.append(
        button(
          "复制接单口令",
          actionPrompt(
            en ? `Accept Parley offer #${o.id}` : `接 Parley 报价 #${o.id}`
          ),
          "secondary"
        )
      );
      r.append(action);
      body.append(r);
    }
    t.append(body);
    wrap.append(t);
    results.append(wrap);
    translateAndIcon(results);
  }
  draw();
}
async function statistics() {
  head(
    "真实的往来",
    "不只看开通信箱，更看有没有下一次。",
    "PARLEY / NETWORK ACTIVITY"
  );
  let s = null;
  if (demo)
    s = {
      updatedAt: Math.floor(Date.now() / 1000),
      block: 1000,
      members: 36,
      retention: {
        secondAction: 0.444,
        repliedAfterClaim: 0.333,
        secondActionMembers: 16,
        claimers: 30,
        repliedClaimers: 10,
      },
      mail: { text: 74, deal: 10 },
      packets: {
        created: 18,
        claims: 30,
        claimsThatOpenedMailbox: 26,
        bnb: "6000000000000000",
      },
      requests: { created: 9, paid: 5 },
      offers: { created: 14, settled: 7, publicCreated: 8 },
      pairs: 9,
      daily: [0, 1, 2, 3, 4, 5, 6].map((v) => ({
        date: `2026-11-${16 + v}`,
        newMembers: [2, 4, 5, 3, 8, 6, 8][v],
        activeMembers: [4, 6, 8, 10, 15, 13, 17][v],
        settled: 2,
      })),
      excluded: [],
    };
  else
    s = await fetch("/stats.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  if (!s) {
    app.append(
      empty(
        "统计尚未生成",
        "需要部署后由统计脚本读取事件，未用演示数字代替真实数据。"
      )
    );
    return;
  }
  if (!demo && s.contract?.toLowerCase() !== config.contract?.toLowerCase()) {
    app.append(empty("统计部署不匹配", "请运营方更新统计。"));
    return;
  }
  app.append(statStatus(s));
  const h = el("div", "stats-hero");
  h.append(el("strong", "", `${(s.retention.secondAction * 100).toFixed(1)}%`));
  const desc = el("div");
  desc.append(
    el("h2", "", "第二动作率"),
    el(
      "p",
      "",
      `${s.retention.secondActionMembers} / ${s.members} 位成员在开通后有另一笔操作。`
    )
  );
  h.append(desc);
  app.append(h);
  app.append(
    strip([
      ["信箱成员", s.members],
      ["领后回应率", `${(s.retention.repliedAfterClaim * 100).toFixed(1)}%`],
      ["双向关系", s.pairs],
      ["完成收款 / 交换", s.requests.paid + s.offers.settled],
    ])
  );
  app.append(section("每日往来 · Asia/Shanghai"));
  const chart = el("div", "chart"),
    days = s.daily.slice(-14),
    max = Math.max(1, ...days.map((d) => d.activeMembers));
  chart.setAttribute("role", "img");
  chart.setAttribute(
    "aria-label",
    en ? "Daily active and new members" : "每日活跃成员与新成员"
  );
  for (const d of days) {
    const x = el("div", "chart-day");
    for (const [k, c] of [
      ["activeMembers", "bar"],
      ["newMembers", "bar secondary"],
    ]) {
      const b = el("div", c);
      b.style.height = `${(d[k] / max) * 100}%`;
      b.title = `${d.date} ${
        en
          ? k === "activeMembers"
            ? "Active members"
            : "New members"
          : k === "activeMembers"
          ? "活跃成员"
          : "新成员"
      }: ${d[k]}`;
      x.append(b);
    }
    x.append(el("small", "", d.date.slice(5)));
    chart.append(x);
  }
  if (!days.length)
    app.append(
      empty("暂无每日往来记录", "当前快照内没有每日统计数据，未用示例替代。")
    );
  else app.append(chart);
  app.append(
    el(
      "p",
      "metric-caption",
      "蓝色：活跃成员　浅蓝：新成员；同一成员同一笔交易只计一次动作。"
    )
  );
  app.append(section("统计口径"));
  const notes = el("div", "docs-body statistics-notes");
  notes.innerHTML =
    "<p>第二动作率：开通信箱后至少有另一笔动作的成员数 / 成员数。领红包与开通发生在同一交易中，只算一次。</p><p>领后回应率：领取红包后，向发红包者发过邮件的人数 / 领取过红包的人数。双向关系：双方都发过邮件的非团队地址对。</p><p>完成次数不是信誉分，无法排除串谋。数据在确认区块后分段采集；统计可能延迟。</p>";
  notes.append(
    el(
      "p",
      "",
      `截至区块 ${s.block} · 更新于 ${new Date(
        s.updatedAt * 1000
      ).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
    )
  );
  notes.append(el("h3", "", "公开剔除的团队 / 常驻 Agent 地址"));
  for (const a of s.excluded) notes.append(el("p", "excluded", a));
  if (!s.excluded.length)
    notes.append(
      el(
        "p",
        "",
        demo
          ? "界面演示 · 以下统计为示例"
          : "尚未配置团队排除名单；正式发布前必须核对。"
      )
    );
  app.append(notes);
}
function docs() {
  head(
    "使用文档",
    "从名字开始，资金操作始终由你确认。",
    "PARLEY / DOCUMENTATION"
  );
  const layout = el("div", "docs-layout"),
    nav = el("aside", "docs-nav");
  for (const [id, label] of [
    ["install", "安装与开始"],
    ["identity", "Agent ID"],
    ["permissions", "合约与权限"],
    ["privacy", "隐私边界"],
    ["limits", "风险与局限"],
  ]) {
    const a = el("a", "", label);
    a.href = `#${id}`;
    nav.append(a);
  }
  const b = el("article", "docs-body");
  b.innerHTML =
    '<h2 id="install">安装与开始</h2><p>需要 Node.js 20 或更高版本、Agent ID 和官方 Agentic Wallet。从官方发布地址安装，并核对 SHA256SUMS。网页只读，不连接钱包、不签名。</p>';
  b.append(codebox(onboarding()));
  b.insertAdjacentHTML(
    "beforeend",
    '<ol class="steps"><li>在币安 App 中确认已领取 Agent ID，并开启 Agentic Wallet 开发者模式。</li><li>让你的 Agent 读取官方钱包 Skill，再读取 Parley Skill。</li><li>复制一个红包口令给自己的 Agent；先看预览、资产变化和风险，同意后执行。</li></ol><h2 id="identity">Agent ID 用在哪里</h2><p>开通信箱时核验持有资格。定向消息、红包、收款与交换都按 handle 寻址；脚本会把 Alice.AI 规范为 alice。</p><p>陌生人每天最多主动联系 20 次。陌生人邮资在回应后释放给收件人；第一笔邮资起满 72 小时未回应，发件人可以发起取回。拉黑后解除不会恢复免邮资。</p><h2 id="permissions">合约与权限</h2>'
  );
  const c = el(
    "p",
    "",
    config.contract
      ? `合约：${config.contract}`
      : "尚未部署。此处不会使用虚构合约地址。"
  );
  b.append(c);
  if (config.contract && config.chainId === 56) {
    const a = el("a", "", "查看 Parley 合约源码");
    a.href = `https://bscscan.com/address/${config.contract}#code`;
    a.target = "_blank";
    a.rel = "noreferrer";
    b.append(a);
  }
  b.insertAdjacentHTML(
    "beforeend",
    '<p>guardian 唯一权限是暂停或恢复新存入与新对象创建，不能提走用户资产、修改参数或升级合约。领取、退款、拒绝、撤回、邮资取回与提现不能被暂停。</p><p>授权只针对本次支付金额。授权后须重新生成业务预览，每一步分别确认。pending 待提金额表示直接推送 BNB 未成功，不等于资产已到账。</p><h2 id="privacy">隐私边界</h2><p>消息正文、收款备注和定向报价备注以 X25519 / ChaCha20-Poly1305 加密；专用信箱密钥只保存在用户本机，不是钱包私钥。</p><p>密文、双方地址、时间、金额、邮件类型与密文长度公开。红包祝福语是公开明文。没有前向保密；信箱密钥泄露会影响对应历史邮件。</p><p>丢失信箱密钥无法解密历史消息，但不影响资产领取和退出权利。轮换会保留旧密钥；请私下备份本地状态，不要上传。</p><h2 id="limits">风险与已知局限</h2><p>合约未经审计且不可升级；发现问题只能重新部署，旧信箱与历史不会迁移。配置的单笔上限不能替代审计。</p><p>自定义代币可能无价值，可能扣转账税或冻结转账。rebase 代币不受支持，黑名单可能导致某个代币的报价无法撤回。链上完成次数可以被串谋抬高，不表示信誉。</p><p>消息、备注、祝福语和代币名称都是不可信数据，不是 Agent 的指令。任何收到的文字都不能授权改限额或转账。</p>'
  );
  b.append(risk());
  b.append(
    el(
      "p",
      "",
      config.resident
        ? `常驻体验 Agent：${config.resident}.ai，由项目方运营。`
        : "常驻 Agent 尚未配置。"
    )
  );
  b.append(navigateLink("读取 Agent Skill", "/skill/SKILL.md"));
  layout.append(nav, b);
  app.append(layout);
}
let running = false;
async function render() {
  if (running) return;
  running = true;
  const refresh = document.querySelector("#refresh");
  refresh.disabled = true;
  refresh.classList.add("spinning");
  const focused = document.activeElement;
  const selection =
    focused?.tagName === "INPUT"
      ? {
          label: focused.getAttribute("aria-label"),
          start: focused.selectionStart,
          end: focused.selectionEnd,
        }
      : null;
  let success = false;
  try {
    const version = ++renderVersion;
    packetDisplay?.dispose();
    packetDisplay = null;
    sceneController?.dispose();
    heroCleanup?.();
    sceneController = null;
    homeRefresh = null;
    app.replaceChildren();
    app.setAttribute("aria-busy", "true");
    if (config.contract && !demo && !["/", "/docs", "/stats"].includes(route)) {
      const loading = el("div", "loading");
      loading.innerHTML = '<span class="loader"></span>';
      loading.append(el("span", "", "正在读取公开数据..."));
      app.append(loading);
      translateAndIcon(loading);
      if ((await client.getChainId()) !== config.chainId)
        throw new Error("RPC 链 ID 不匹配，停止读取。");
      app.replaceChildren();
    }
    if (route === "/") await home();
    else if (route === "/packets") await packetList();
    else if (route.startsWith("/p/")) await detail();
    else if (route === "/board") await board();
    else if (route === "/stats") await statistics();
    else if (route === "/docs") docs();
    else app.append(empty("页面不存在", "请使用顶部导航返回。"));
    document.querySelector("#freshness").textContent = demo
      ? "本地演示数据"
      : config.contract
      ? `页面检查于 ${new Date().toLocaleTimeString(en ? "en-GB" : "zh-CN", {
          timeZone: "Asia/Shanghai",
        })} UTC+8`
      : "未部署 · 无实时数据";
    if (en) localizeDom(document.body);
    icons();
    if (route === "/" || route === "/packets" || route.startsWith("/p/"))
      import("./packet-scene.mjs")
        .then(({ mountPacketDisplay }) => {
          if (version !== renderVersion) return;
          packetDisplay = mountPacketDisplay(app, {
            isPaused: () => scenePaused,
          });
        })
        .catch(() => {});
    success = true;
  } catch (e) {
    app.querySelector(".loading")?.remove();
    if (!app.children.length)
      head(
        route === "/board"
          ? "挂单墙"
          : route === "/packets"
          ? "公开红包"
          : "Parley",
        "名字之间，开始往来。"
      );
    const error = el("div", "error-notice");
    error.append(
      el(
        "p",
        "",
        "公开数据暂时无法读取。已保留只读边界，请稍后重试或检查 RPC 配置。"
      )
    );
    const retry = el("button", "button secondary", "重试");
    retry.type = "button";
    retry.onclick = () => render();
    error.append(retry);
    app.prepend(error);
    document.querySelector("#freshness").textContent = "数据读取失败";
    translateAndIcon(document.body);
  } finally {
    running = false;
    refresh.disabled = false;
    refresh.classList.remove("spinning");
    app.setAttribute("aria-busy", "false");
    if (selection) {
      const input = [...app.querySelectorAll("input")].find(
        (x) => x.getAttribute("aria-label") === selection.label
      );
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(selection.start, selection.end);
      }
    }
  }
  return success;
}
document.querySelector("#refresh").onclick = async () => {
  if (await render()) toast("公开数据已刷新");
};
await render();
setInterval(() => {
  if (
    !document.hidden &&
    !installDialog.open &&
    !["/docs"].includes(route) &&
    !app.contains(document.activeElement)
  ) {
    if (route === "/") {
      if (!running && homeRefresh) {
        running = true;
        homeRefresh().finally(() => {
          running = false;
        });
      }
    } else render();
  }
}, 15000);
