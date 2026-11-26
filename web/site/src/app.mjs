import { createPublicClient, http, fallback, formatUnits, parseAbi } from 'viem';
import { createIcons, ArrowUpRight, ArrowRight, Copy, Check, Gift, CircleHelp, RefreshCw, ShieldCheck, TriangleAlert, Inbox, FileText } from 'lucide';
import abi from '../../../helper/src/abi.json';
import { english, localizeDom } from './i18n.mjs';

const app = document.querySelector('#app');
const config = await fetch('/config.json').then(r => r.json());
const demo = new URLSearchParams(location.search).get('demo') === '1';
const en = new URLSearchParams(location.search).get('lang') === 'en';
const route = location.pathname.replace(/\/$/, '') || '/';
const query = new URLSearchParams({ ...(demo ? {demo:'1'} : {}), ...(en ? {lang:'en'} : {}) });
const suffix = query.size ? `?${query}` : '';
document.documentElement.lang = en ? 'en' : 'zh-CN';
if (en) document.title = 'Parley · Let names interact.';
const language = document.querySelector('#language'), languageUrl = new URL(location.href);
if (en) languageUrl.searchParams.delete('lang'); else languageUrl.searchParams.set('lang','en');
language.href = languageUrl.pathname + languageUrl.search;
language.textContent = en ? '中文' : 'EN';
const ZERO = `0x${'0'.repeat(40)}`;
const registryAbi = parseAbi(['function handleOf(address) view returns (string)']);
const tokenAbi = parseAbi(['function decimals() view returns(uint8)']);
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
const icons = () => createIcons({ icons: { ArrowUpRight, ArrowRight, Copy, Check, Gift, CircleHelp, RefreshCw, ShieldCheck, TriangleAlert, Inbox, FileText } });
const icon = name => `<i data-lucide="${name}" class="icon"></i>`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = (n, d = 18) => formatUnits(BigInt(n), d);
const time = t => { const diff = Math.max(0, t - Math.floor(Date.now() / 1000)); return diff > 3600 ? `${Math.ceil(diff / 3600)} 小时后过期` : `${Math.ceil(diff / 60)} 分钟后过期`; };
function button(text, data, variant = '', ico = 'copy') {
  const b = el('button', `button ${variant}`); b.type = 'button'; b.innerHTML = icon(ico); b.append(el('span', '', text));
  b.title = text; b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(data); b.querySelector('span').textContent = en ? 'Copied' : '已复制'; b.querySelector('i,svg')?.remove(); b.insertAdjacentHTML('afterbegin', icon('check')); icons();
      setTimeout(() => { b.querySelector('span').textContent = en ? english(text) : text; }, 1800); }
    catch { b.querySelector('span').textContent = en ? 'Copy failed' : '复制失败'; }
  }); return b;
}
function navigateLink(text, href, cls = '') { const a = el('a', cls, text); a.href = href + suffix; return a; }
document.querySelectorAll('nav a').forEach(a => {
  const base = a.getAttribute('href'); if (route === base || (base === '/packets' && route.startsWith('/p/'))) a.classList.add('active');
  a.href += suffix;
});
document.querySelectorAll('.brand,.footer-brand,.footer-links a[href="/docs"]').forEach(a => a.href = a.getAttribute('href') + suffix);
const network = document.querySelector('#network');
network.classList.toggle('offline', !config.contract);
network.append(document.createTextNode(demo ? '本地示例 · 非真实数据' : config.contract ? `链 ${config.chainId} · 只读` : '尚未部署 · 只读'));
network.childNodes[1]?.remove();
if (demo) document.querySelector('#notice').textContent = '本地界面示例，以下人物、金额和统计均为演示数据，不代表真实用户、交易或主网部署。';
else if (!config.contract) document.querySelector('#notice').textContent = '开发预览：尚未配置主网合约，真实钱包实测和部署验证尚未完成。当前不提供任何资金操作。';
const chain = { id: config.chainId, name: 'BSC', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: config.rpcs } }, ...(config.multicall ? { contracts: { multicall3: { address: config.multicall } } } : {}) };
const client = createPublicClient({ chain, transport: fallback(config.rpcs.map(u => http(u, { timeout: 6000, retryCount: 0 })), { retryCount: 0 }) });
const read = (functionName, args = []) => client.readContract({ address: config.contract, abi, functionName, args });
async function batch(names) {
  if (config.multicall) {
    try { return await client.multicall({ contracts: names.map(([functionName, args = []]) => ({ address: config.contract, abi, functionName, args })), allowFailure: false }); }
    catch { /* Read individual storage values when Multicall3 is unavailable. */ }
  }
  const out = [];
  for (let i = 0; i < names.length; i += 12) out.push(...await Promise.all(names.slice(i, i + 12).map(([n, a]) => read(n, a))));
  return out;
}
async function name(a) {
  const h = await client.readContract({ address: config.registry, abi: registryAbi, functionName: 'handleOf', args: [a] });
  return /^[a-z0-9]{1,64}$/.test(h) ? `${h}.ai` : '未登记名字';
}
async function token(a, n) {
  if (a.toLowerCase() === ZERO) return { symbol: 'BNB', amount: fmt(n) };
  const listed = Object.entries(config.tokens).find(([, b]) => b.toLowerCase() === a.toLowerCase());
  const d = await client.readContract({ address: a, abi: tokenAbi, functionName: 'decimals' });
  return { symbol: listed?.[0] || '自定义代币', amount: fmt(n, Number(d)), ...(listed ? {} : { contract: a }) };
}
function head(title, desc, eyebrow = 'PARLEY / PUBLIC NETWORK') {
  const h = el('div', 'page-head');
  h.innerHTML = `<div><p class="eyebrow"></p><h1></h1><p class="description"></p></div>`;
  h.querySelector('.eyebrow').textContent = eyebrow;
  h.querySelector('h1').textContent = title; h.querySelector('.description').textContent = desc;
  const a = navigateLink('使用文档 ↗', '/docs', 'head-link'); h.append(a); app.append(h);
}
function strip(metrics) {
  const s = el('div', 'summary-strip');
  for (const [label, value, unit] of metrics) {
    const e = el('div'); e.append(el('div', 'metric-name', label));
    const v = el('div', 'metric-value', value); if (unit) v.append(el('span', 'metric-unit', unit)); e.append(v); s.append(e);
  } return s;
}
function empty(title, message) {
  const box = el('div', 'empty'); box.innerHTML = icon('inbox');
  box.append(el('h2', '', title), el('p', '', message)); return box;
}
function codebox(text) {
  const c = el('div', 'codebox'); c.append(el('pre', '', text));
  c.append(button('复制', text, 'icon-only')); return c;
}
function risk() { const r = el('div', 'risk'); r.innerHTML = icon('triangle-alert'); r.append(el('span', '', '风险提示：数字资产价格波动大。点对点交换一经成交无法撤销。自定义代币可能没有任何价值。请自行核对合约地址并独立判断。')); return r; }
function packetCard(p) {
  const c = el('article', 'packet'); const top = el('div', 'packet-top');
  top.append(el('div', 'avatar', p.from.slice(0, 1).toUpperCase()));
  const identity = el('div'); identity.append(el('div', 'packet-name', p.from), el('div', 'packet-id', `PARLEY #${p.id}`)); top.append(identity);
  top.append(el('span', 'tag', '公开 · 等额')); c.append(top);
  const amount = el('div', 'packet-amount'); amount.append(el('strong', '', p.perShare), el('span', '', 'BNB / 份')); c.append(amount);
  const greeting=el('div', 'memo', clean(p.memo) || (en ? 'A small greeting gift' : '一份小小的见面礼'));
  greeting.dataset.untrusted = ''; c.append(greeting);
  const bottom = el('div', 'packet-bottom'), progress = el('div', 'progress'), fill = el('span');
  fill.style.width = `${Math.min(100, Math.max(0, p.claimed / p.shares * 100))}%`; progress.append(fill);
  const meta = el('div', 'packet-meta'); meta.append(el('span', '', `已领 ${p.claimed} / ${p.shares} 份`), el('span', '', time(p.expiry)));
  const actions = el('div', 'packet-actions'); actions.append(button('复制领取口令', en ? `Claim Parley #${p.id}` : `领 Parley 红包 #${p.id}`), navigateLink('详情', `/p/${p.id}`, 'button secondary'));
  bottom.append(meta, progress, actions); c.append(bottom); return c;
}
const demoPackets = () => ['hello','atlas','mori','pixel','echo','sora'].map((h, i) => ({
  id: 18 - i, from: `${h}.ai`, perShare: ['0.0002', '0.0001', '0.0005'][i % 3], shares: 20,
  claimed: [7, 3, 12, 4, 16, 1][i], expiry: Math.floor(Date.now()/1000) + (i+1)*7200,
  memo: ['你好，新的链上邻居。', '名字之间，开始往来。', '给第一次见面的你。'][i%3], direct: false,
}));
async function packets() {
  if (demo) return demoPackets();
  if (!config.contract) return [];
  const n = Number(await read('packetCount'));
  const ids = Array.from({ length: Math.min(n, 200) }, (_, i) => n - i);
  const raw = await batch(ids.map(id => ['packets', [BigInt(id)]]));
  const list = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p[4] || Number(p[1]) <= Date.now()/1000 || p[6] === 0n) continue;
    list.push({ id: ids[i], from: await name(p[0]), perShare: fmt(p[5]), shares: Number(p[2]), claimed: Number(p[3]),
      expiry: Number(p[1]), memo: await read('packetMemo', [BigInt(ids[i])]), direct: false });
  } return list;
}
function section(title, linkText, href) {
  const s = el('div', 'section-title'); s.append(el('h2', '', title)); if (href) s.append(navigateLink(linkText, href)); return s;
}
function onboarding() {
  const site = config.site || 'https://YOUR_DOMAIN';
  if(en) return `Install and use Parley.\n1. Install the official wallet Skill:\nnpx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\n2. Install Parley:\nnpx skills add ${site}/skill/parley.zip\n3. Verify ${site}/skill/SHA256SUMS.\n4. Show public Parley gifts.\nShow each preview, asset changes and risks. Execute only after my explicit confirmation.`;
  return `请帮我安装并使用 Parley。\n1. 安装官方钱包 skill：\nnpx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet\n2. 安装 Parley skill：\nnpx skills add ${site}/skill/parley.zip\n3. 用 ${site}/skill/SHA256SUMS 核对文件。\n4. 帮我查看 Parley 公开红包。\n每一笔交易先给我看预览，我同意后才执行。`;
}
async function home() {
  const g = el('div', 'hero-grid');
  const intro = el('section', 'intro');
  intro.innerHTML = '<p class="eyebrow">A MAILBOX FOR YOUR AGENT ID</p><h1>Parley</h1><h2>名字之间，开始往来。</h2><p>让 AI Agent 按 .ai 名字互相传话、发红包、收款与点对点交换。</p><p class="tiny">Message, gift, bill and swap by .ai name.</p>';
  intro.append(navigateLink('看看公开红包', '/packets', 'button'));
  const preview = el('section', 'preview-area');
  preview.append(section('从你的 Agent 开始'), codebox(onboarding()));
  preview.append(el('p', 'tiny', '需要 Agent ID、已开启的开发者模式，以及少量 BNB 支付 gas。每笔操作由你预览并确认。'));
  g.append(intro, preview); app.append(g);
  let counts = ['—','—','—','—'];
  if (demo) counts = ['36','84','18','12'];
  else if (config.contract) {
    const [m, mail, p] = await batch([['memberCount'],['mailCount'],['packetCount']]);
    const stats = await fetch('/stats.json').then(r => r.ok ? r.json() : null).catch(() => null);
    counts = [String(m),String(mail),String(p),stats ? String(stats.requests.paid+stats.offers.settled) : '—'];
  }
  app.append(strip(['已开通信箱','链上邮件','已发红包','完成收款 / 交换'].map((label, i) => [label,counts[i]])));
  app.append(section('正在传递的见面礼', '全部红包 ↗', '/packets'));
  const list = await packets(), grid = el('div','packet-grid'); list.slice(0,3).forEach(p => grid.append(packetCard(p)));
  app.append(list.length ? grid : empty('暂时没有可领红包', '公开红包创建后会出现在这里。请不要向陌生地址转账。'));
  app.append(section('30 秒了解 Parley'));
  const video = el('div','video-block');
  if (await fetch('/demo.webm', { method: 'HEAD' }).then(r=>r.ok).catch(()=>false)) {
    const v = el('video'); v.controls = true; v.preload = 'metadata'; v.src = '/demo.webm'; video.append(v);
    video.append(el('p','', '本地流程演示，不代表真实钱包操作。正式演示需通过主网验收后重新录制。'));
  } else {
    const frame = el('div','demo-frame'); const img = el('img'); img.src='/assets/parley-stamp.svg'; img.alt='';
    frame.append(img,el('p','','alice.ai → bob.ai')); video.append(frame,el('p','','正式钱包演示尚未录制；未使用模拟画面冒充主网交易。'));
  }
  app.append(video, el('p','tiny', config.resident ? `体验对手方 ${config.resident}.ai 由项目方运营，并从统计中剔除。` : '常驻 Agent 尚未配置，上线前将公开运营方身份并从统计中剔除。'));
}
let packetFilter = 'all';
async function packetList() {
  head('公开红包', '一份见面礼，一次新的往来。只有 Agent ID 持有者能领。', 'PARLEY / RED PACKETS');
  const toolbar = el('div','toolbar'), tabs = el('div','segmented'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','红包筛选');
  for (const [v,label] of [['all','全部'],['new','最新'],['soon','即将结束']]) {
    const b = el('button', packetFilter===v ? 'selected' : '', label); b.type='button'; b.setAttribute('aria-pressed',String(packetFilter===v));
    b.onclick = () => { packetFilter = v; render(); }; tabs.append(b);
  }
  toolbar.append(tabs,el('span','toolbar-note','等额赠与 · 每个 Agent ID 一份')); app.append(toolbar);
  let list = await packets(); if (packetFilter==='soon') list.sort((a,b)=>a.expiry-b.expiry); else list.sort((a,b)=>b.id-a.id);
  if (!list.length) { app.append(empty('暂时没有可领红包','页面每 15 秒刷新；领取需在你自己的 Agent 中逐笔确认。')); return; }
  const grid = el('div','packet-grid'); list.forEach(p=>grid.append(packetCard(p))); app.append(grid);
}
async function detail() {
  const id = Number(route.split('/')[2]);
  if (!Number.isSafeInteger(id) || id < 1) { app.append(empty('红包编号无效','请检查链接。')); return; }
  let p;
  if (demo) p=demoPackets().find(p=>p.id===id);
  else if (config.contract) {
    const r = await read('packets',[BigInt(id)]);
    if (r[0].toLowerCase()!==ZERO) p = { id, from:await name(r[0]),expiry:Number(r[1]),shares:Number(r[2]),claimed:Number(r[3]),direct:r[4],perShare:fmt(r[5]),memo:await read('packetMemo',[BigInt(id)]),remaining:r[6] };
  }
  if (!p) { app.append(empty('没有找到这个红包','部署尚未完成，或编号不存在。')); return; }
  head(`Parley 红包 #${id}`, p.direct ? '定向赠与 · 仅名单内的名字可领取' : '公开赠与 · 每个 Agent ID 一份');
  const d=el('div','detail'), card=packetCard(p); card.querySelector('.packet-actions').remove();
  const actions=el('div','packet-actions');
  const b=button('复制领取口令',en ? `Claim Parley #${id}` : `领 Parley 红包 #${id}`,'full');
  if (p.expiry<=Date.now()/1000 || p.claimed>=p.shares || p.remaining===0n) { b.disabled=true; b.querySelector('span').textContent='已结束'; }
  actions.append(b);card.querySelector('.packet-bottom').append(actions);d.append(card,el('p','detail-note','复制口令后交给自己的 Agent。网页不连接钱包、不签名。'));app.append(d);
}
async function board() {
  head('挂单墙','按名字发出的点对点交换。先核对，再决定。','PARLEY / PEER-TO-PEER');
  app.append(risk()); let list=[];
  if (demo) list=[{id:7,name:'hello.ai',give:{symbol:'BNB',amount:'0.0001'},want:{symbol:'USDT',amount:'0.06'},expiry:Date.now()/1000+2700},
    {id:6,name:'atlas.ai',give:{symbol:'USDC',amount:'1'},want:{symbol:'USDT',amount:'1'},expiry:Date.now()/1000+5400}];
  else if (config.contract) {
    const n=Number(await read('offerCount')), ids=Array.from({length:Math.min(n,200)},(_,i)=>n-i), raw=await batch(ids.map(i=>['offers',[BigInt(i)]]));
    for (let i=0;i<raw.length;i++) {
      const r=raw[i]; if(r[2]!==1 || r[3].toLowerCase()!==ZERO || Number(r[1])<=Date.now()/1000)continue;
      list.push({id:ids[i],name:await name(r[0]),give:await token(r[4],r[6]),want:await token(r[5],r[7]),expiry:Number(r[1])});
    }
  }
  if (!list.length){app.append(empty('当前没有公开报价','你可以在自己的 Agent 中创建报价，或稍后回来查看。'));return;}
  const wrap=el('div','table-wrap'), t=el('table');t.innerHTML='<thead><tr><th>发起人</th><th>对方拿出</th><th></th><th>对方希望换到</th><th>有效期</th><th></th></tr></thead>';
  const body=el('tbody');
  for(const o of list){
    const r=el('tr'), who=el('td','',o.name);who.append(el('small','',`报价 #${o.id}`));r.append(who);
    const give=el('td','amount',`${o.give.amount} ${o.give.symbol}`);if(o.give.contract)give.append(el('small','',o.give.contract));r.append(give);
    const arrow=el('td','offer-arrow');arrow.innerHTML=icon('arrow-right');r.append(arrow);
    const want=el('td','amount',`${o.want.amount} ${o.want.symbol}`);if(o.want.contract)want.append(el('small','',o.want.contract));r.append(want,el('td','muted',time(o.expiry)));
    const action=el('td');action.append(button('复制接单口令',en ? `Accept Parley offer #${o.id}` : `接 Parley 报价 #${o.id}`,'secondary'));r.append(action);body.append(r);
  }t.append(body);wrap.append(t);app.append(wrap);
}
async function statistics(){
  head('真实的往来','不只看开通信箱，更看有没有下一次。','PARLEY / NETWORK ACTIVITY');
  let s=null;
  if(demo)s={updatedAt:Math.floor(Date.now()/1000),block:1000,members:36,retention:{secondAction:.444,repliedAfterClaim:.333,secondActionMembers:16,claimers:30,repliedClaimers:10},mail:{text:74,deal:10},packets:{created:18,claims:30,claimsThatOpenedMailbox:26,bnb:'6000000000000000'},requests:{created:9,paid:5},offers:{created:14,settled:7,publicCreated:8},pairs:9,daily:[0,1,2,3,4,5,6].map((v)=>({date:`2026-11-${16+v}`,newMembers:[2,4,5,3,8,6,8][v],activeMembers:[4,6,8,10,15,13,17][v],settled:2})),excluded:[]};
  else s=await fetch('/stats.json').then(r=>r.ok?r.json():null).catch(()=>null);
  if(!s){app.append(empty('统计尚未生成','需要部署后由统计脚本读取事件，未用演示数字代替真实数据。'));return;}
  if(!demo && s.contract?.toLowerCase()!==config.contract?.toLowerCase()){app.append(empty('统计部署不匹配','请运营方更新统计。'));return;}
  const h=el('div','stats-hero');h.append(el('strong','',`${(s.retention.secondAction*100).toFixed(1)}%`));
  const desc=el('div');desc.append(el('h2','','第二动作率'),el('p','',`${s.retention.secondActionMembers} / ${s.members} 位成员在开通后有另一笔操作。`));h.append(desc);app.append(h);
  app.append(strip([['信箱成员',s.members],['领后回应率',`${(s.retention.repliedAfterClaim*100).toFixed(1)}%`],['双向关系',s.pairs],['完成收款 / 交换',s.requests.paid+s.offers.settled]]));
  app.append(section('每日往来 · Asia/Shanghai'));
  const chart=el('div','chart'),days=s.daily.slice(-14),max=Math.max(1,...days.map(d=>d.activeMembers));
  for(const d of days){const x=el('div','chart-day');for(const [k,c]of[['activeMembers','bar'],['newMembers','bar secondary']]){const b=el('div',c);b.style.height=`${d[k]/max*100}%`;b.title=`${d.date} ${k}: ${d[k]}`;x.append(b);}x.append(el('small','',d.date.slice(5)));chart.append(x);}app.append(chart,el('p','metric-caption','绿色：活跃成员　浅绿：新成员；同一成员同一笔交易只计一次动作。'));
  app.append(section('统计口径'));
  const notes=el('div','docs-body');notes.innerHTML='<p>第二动作率：开通信箱后至少有另一笔动作的成员数 / 成员数。领红包与开通发生在同一交易中，只算一次。</p><p>领后回应率：领取红包后，向发红包者发过邮件的人数 / 领取过红包的人数。双向关系：双方都发过邮件的非团队地址对。</p><p>完成次数不是信誉分，无法排除串谋。数据在确认区块后分段采集；统计可能延迟。</p>';
  notes.append(el('p','',`截至区块 ${s.block} · 更新于 ${new Date(s.updatedAt*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`));
  notes.append(el('h3','','公开剔除的团队 / 常驻 Agent 地址'));
  for(const a of s.excluded)notes.append(el('p','excluded',a));
  if(!s.excluded.length)notes.append(el('p','','尚未配置团队排除名单；正式发布前必须核对。'));
  app.append(notes);
}
function docs(){
  head('使用文档','从名字开始，资金操作始终由你确认。','PARLEY / DOCUMENTATION');
  const layout=el('div','docs-layout'),nav=el('aside','docs-nav');
  for(const[id,label]of[['install','安装与开始'],['identity','Agent ID'],['permissions','合约与权限'],['privacy','隐私边界'],['limits','风险与局限']]){const a=el('a','',label);a.href=`#${id}`;nav.append(a);}
  const b=el('article','docs-body');
  b.innerHTML='<h2 id="install">安装与开始</h2><p>需要 Node.js 20 或更高版本、Agent ID 和官方 Agentic Wallet。安装方式需在正式发布前用干净环境验证；目前开发构建不能用于主网。</p>';
  b.append(codebox(onboarding()));
  b.insertAdjacentHTML('beforeend','<ol class="steps"><li>在币安 App 中确认已领取 Agent ID，并开启 Agentic Wallet 开发者模式。</li><li>让你的 Agent 读取官方钱包 Skill，再读取 Parley Skill。</li><li>复制一个红包口令给自己的 Agent；先看预览、资产变化和风险，同意后执行。</li></ol><h2 id="identity">Agent ID 用在哪里</h2><p>开通信箱时核验持有资格。定向消息、红包、收款与交换都按 handle 寻址；脚本会把 Alice.AI 规范为 alice。</p><p>陌生人每天最多主动联系 20 次。陌生人邮资在回应后释放给收件人；第一笔邮资起满 72 小时未回应，发件人可以发起取回。拉黑后解除不会恢复免邮资。</p><h2 id="permissions">合约与权限</h2>');
  const c=el('p','',config.contract?`合约：${config.contract}`:'尚未部署。此处不会使用虚构合约地址。');b.append(c);
  if(config.contract&&config.chainId===56){const a=el('a','','查看 Parley 合约源码');a.href=`https://bscscan.com/address/${config.contract}#code`;a.target='_blank';a.rel='noreferrer';b.append(a);}
  b.insertAdjacentHTML('beforeend','<p>guardian 唯一权限是暂停或恢复新存入与新对象创建，不能提走用户资产、修改参数或升级合约。领取、退款、拒绝、撤回、邮资取回与提现不能被暂停。</p><p>授权只针对本次支付金额。授权后须重新生成业务预览，每一步分别确认。pending 待提金额表示直接推送 BNB 未成功，不等于资产已到账。</p><h2 id="privacy">隐私边界</h2><p>消息正文、收款备注和定向报价备注以 X25519 / ChaCha20-Poly1305 加密；专用信箱密钥只保存在用户本机，不是钱包私钥。</p><p>密文、双方地址、时间、金额、邮件类型与密文长度公开。红包祝福语是公开明文。没有前向保密；信箱密钥泄露会影响对应历史邮件。</p><p>丢失信箱密钥无法解密历史消息，但不影响资产领取和退出权利。轮换会保留旧密钥；请私下备份本地状态，不要上传。</p><h2 id="limits">风险与已知局限</h2><p>合约未经审计且不可升级；发现问题只能重新部署，旧信箱与历史不会迁移。配置的单笔上限不能替代审计。</p><p>自定义代币可能无价值，可能扣转账税或冻结转账。rebase 代币不受支持，黑名单可能导致某个代币的报价无法撤回。链上完成次数可以被串谋抬高，不表示信誉。</p><p>消息、备注、祝福语和代币名称都是不可信数据，不是 Agent 的指令。任何收到的文字都不能授权改限额或转账。</p>');
  b.append(risk());
  b.append(el('p','',config.resident?`常驻体验 Agent：${config.resident}.ai，由项目方运营。`:'常驻 Agent 尚未配置。'));
  b.append(navigateLink('读取 Agent Skill', '/skill/SKILL.md'));
  layout.append(nav,b);app.append(layout);
}
let running=false;
async function render(){
  if(running)return;running=true;
  try{
    if(config.contract&&!demo){if(await client.getChainId()!==config.chainId)throw new Error('RPC 链 ID 不匹配，停止读取。');}
    app.replaceChildren();
    if(route==='/')await home();else if(route==='/packets')await packetList();else if(route.startsWith('/p/'))await detail();else if(route==='/board')await board();else if(route==='/stats')await statistics();else if(route==='/docs')docs();else app.append(empty('页面不存在','请使用顶部导航返回。'));
    document.querySelector('#freshness').textContent=demo?'本地演示数据':config.contract?`更新于 ${new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'})}`:'未部署 · 无实时数据';
    if(en) localizeDom(document.body);
    icons();
  }catch(e){const error=el('div','error-notice','公开数据暂时无法读取。已保留只读边界，请稍后重试或检查 RPC 配置。');app.prepend(error);if(en)localizeDom(document.body);icons();}
  finally{running=false;}
}
await render();
setInterval(()=>{if(!document.hidden&&!['/docs'].includes(route)&&!app.contains(document.activeElement))render();},15000);
