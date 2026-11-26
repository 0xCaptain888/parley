function forkInputs(env) {
  let rpc;
  try { rpc = new URL(env.FORK_RPC); } catch { throw new Error("FORK_RPC must be an HTTP(S) archive RPC URL"); }
  if (!["https:", "http:"].includes(rpc.protocol)) throw new Error("FORK_RPC must use HTTP(S)");
  if (!/^[1-9][0-9]*$/.test(env.FORK_BLOCK || "") || !Number.isSafeInteger(Number(env.FORK_BLOCK)))
    throw new Error("FORK_BLOCK must be an explicit positive safe integer for reproducible checks");
  const actors = (env.FORK_ACTORS || "").split(",").map(a => a.trim());
  if (actors.length !== 2 || actors.some(a => !/^0x[0-9a-fA-F]{40}$/.test(a) || /^0x0{40}$/i.test(a))
    || actors[0].toLowerCase() === actors[1].toLowerCase())
    throw new Error("FORK_ACTORS requires two distinct nonzero public Agent ID holders; no private keys");
  return { block: Number(env.FORK_BLOCK), actors };
}
module.exports = { forkInputs };
