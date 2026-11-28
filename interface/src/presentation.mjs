export function sourceOrder({ count = 0 } = {}) {
  return count > 0 ? ["live", "example"] : ["example", "live"];
}

export function pageKind(path) {
  if (path.startsWith("/p/")) return "gift";
  return { "/": "overview", "/packets": "gifts", "/board": "offers",
    "/stats": "activity", "/docs": "guide" }[path] || "guide";
}

export function exampleGifts(now = Math.floor(Date.now() / 1000), en = false) {
  return ["hello", "atlas", "mori"].map((handle, index) => ({
    id: index + 1,
    from: `${handle}.ai`,
    shares: 20,
    claimed: [7, 3, 12][index],
    expiry: now + (index + 1) * 7200,
    memo: (en
      ? ["Hello, new on-chain neighbor.", "Let names interact.", "A little hello, just for you."]
      : ["你好，新的链上邻居。", "名字之间，开始往来。", "给第一次见面的你。"])[index],
    direct: false,
  }));
}

export const exampleOffers = [
  { name: "hello.ai", give: "1.00 USDC", want: "1.00 USDT" },
  { name: "atlas.ai", give: "0.001 BNB", want: "0.60 USDT" },
];

export const exampleActivity = {
  members: 36,
  mail: 84,
  gifts: 18,
  secondAction: "44.4%",
  days: [
    { label: "MON", active: 4, joined: 2 },
    { label: "TUE", active: 6, joined: 4 },
    { label: "WED", active: 8, joined: 5 },
    { label: "THU", active: 10, joined: 3 },
    { label: "FRI", active: 15, joined: 8 },
    { label: "SAT", active: 13, joined: 6 },
    { label: "SUN", active: 17, joined: 8 },
  ],
};
