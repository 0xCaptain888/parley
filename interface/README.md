# Parley Interface

[中文](#中文) · [English](#english)

## 中文

这是新版公网站点源码，独立于 `web/` 中的历史构建。网页只读取公共链上数据，
不连接钱包、不签名、不广播。每页都有独立标记的虚构演示区：有真实记录时
真实区在前，暂无记录时演示区在前。示例不能领取或成交，不计入真实统计；
读取失败不会用示例替换真实结果。`?demo=1` 可切换到整页虚构演示模式。

```sh
cd interface
npm ci --ignore-scripts
npm run build
npm test
npm run dev
```

预览：<http://127.0.0.1:4186/>。Node.js 22 或更高版本。
红包开合只是视觉效果；隐藏金额不等于隐私保护或随机分配。
当前正式合约仍是等额分配。

`release-manifest.json` 分开记录原合约/helper 快照与新版前端来源；
源码验证不等于安全审计，前端更新不继承旧复核结论。

## English

This is the redesigned public interface, separate from the historical `web/`
build. It reads public chain data without connecting a wallet, signing, or
broadcasting. Every page has a separately labeled fictional example section:
real records lead when available, otherwise examples lead. Examples cannot
be claimed or traded and never contribute to real statistics. Read failures
are not replaced by fictional results. `?demo=1` enables the full-page
fictional demo mode.

Run the commands above with Node.js 22 or newer, then open
<http://127.0.0.1:4186/>. Envelope opening is visual only. Hidden amounts do
not provide financial privacy or random allocation; the deployed contract
still uses fixed shares.

The release manifest separates original contract/helper provenance from
frontend provenance. Source verification is not an audit, and a frontend
update does not inherit earlier review conclusions.
