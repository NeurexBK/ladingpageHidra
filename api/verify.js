// Verificacao de pagamento Solana (server-side) para a HidraNet.
// GET /api/verify?reference=<pubkey base58>&os=<windows|mac-arm|mac-intel|linux>
// Retorna { paid:true, url, signature } quando encontra um pagamento >= ~US$0.90
// referenciando a chave 'reference' e transferido para a carteira do projeto.

const RPC = 'https://solana-rpc.publicnode.com';
const MERCHANT = '9Uz7VyeBFmEU8sKnCwFsGC8AczjmLqnxZjQG7Vsm79sZ';
const BASE = 'https://github.com/NeurexBK/HidraNet/releases/download/v1.0.0/';
const FILES = {
  'windows': 'HidraNet-Browser-1.0.0-Windows-x64.zip',
  'mac-arm': 'HidraNet-Browser-1.0.0-macOS-arm64.zip',
  'mac-intel': 'HidraNet-Browser-1.0.0-macOS-x64.zip',
  'linux': 'HidraNet-Browser-1.0.0-Linux-x64.zip'
};

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const j = await r.json();
  if (j.error) throw new Error((j.error && j.error.message) || 'rpc error');
  return j.result;
}

let priceCache = { v: null, t: 0 };
async function solPriceUsd() {
  const now = Date.now();
  if (priceCache.v && (now - priceCache.t) < 60000) return priceCache.v;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const j = await r.json();
    const v = (j && j.solana && j.solana.usd) || null;
    if (v) priceCache = { v, t: now };
    return v;
  } catch (_) { return priceCache.v; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  try {
    const q = req.query || {};
    const ref = String(q.reference || '').trim();
    const os = String(q.os || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref)) {
      return res.status(400).json({ error: 'reference invalida' });
    }
    const file = FILES[os];
    if (!file) return res.status(400).json({ error: 'os invalido' });

    // valor minimo aceito: ~US$0.90 em SOL (tolerancia de preco)
    const price = await solPriceUsd();
    const minLamports = price ? Math.floor((0.9 / price) * 1e9) : 1000000;

    const sigs = await rpc('getSignaturesForAddress', [ref, { limit: 10 }]);
    if (!Array.isArray(sigs) || !sigs.length) return res.status(200).json({ paid: false });

    for (const s of sigs) {
      if (s.err) continue;
      if (s.confirmationStatus !== 'confirmed' && s.confirmationStatus !== 'finalized') continue;
      let tx;
      try {
        tx = await rpc('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
      } catch (_) { continue; }
      if (!tx || !tx.meta || tx.meta.err) continue;
      const keys = (tx.transaction.message.accountKeys || []).map(k => (k && k.pubkey) ? k.pubkey : k);
      const mi = keys.indexOf(MERCHANT);
      if (mi < 0) continue;
      const delta = tx.meta.postBalances[mi] - tx.meta.preBalances[mi];
      if (delta >= minLamports) {
        return res.status(200).json({ paid: true, url: BASE + file, signature: s.signature });
      }
    }
    return res.status(200).json({ paid: false });
  } catch (e) {
    // erro transitorio de rede/RPC: cliente deve tentar de novo
    return res.status(200).json({ paid: false, note: 'retry' });
  }
};
