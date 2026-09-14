// Verificacao de pagamento Solana (server-side) para a HidraNet.
// GET /api/verify?amount=<lamports>&os=<windows|mac-arm|mac-intel|linux>&since=<ms>
// Confirma se a carteira do projeto recebeu EXATAMENTE <amount> lamports numa
// transacao apos <since>. O valor unico (base + sal aleatorio) evita confusao
// entre pagamentos. Funciona com qualquer carteira (nao depende de reference).

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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  try {
    const q = req.query || {};
    const amount = parseInt(q.amount, 10);
    const os = String(q.os || '').trim();
    const since = parseInt(q.since, 10) || 0;
    const file = FILES[os];
    if (!file) return res.status(400).json({ error: 'os invalido' });
    if (!amount || amount < 100000 || amount > 2000000000) return res.status(400).json({ error: 'amount invalido' });

    const sigs = await rpc('getSignaturesForAddress', [MERCHANT, { limit: 25 }]);
    if (!Array.isArray(sigs)) return res.status(200).json({ paid: false });

    let checked = 0;
    for (const s of sigs) {
      if (s.err) continue;
      // ignora transacoes muito anteriores ao inicio da cobranca (tolerancia 10 min)
      if (since && s.blockTime && (s.blockTime * 1000) < (since - 600000)) continue;
      if (checked++ > 18) break;
      let tx;
      try {
        tx = await rpc('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
      } catch (_) { continue; }
      if (!tx || !tx.meta || tx.meta.err) continue;
      const keys = (tx.transaction.message.accountKeys || []).map(k => (k && k.pubkey) ? k.pubkey : k);
      const mi = keys.indexOf(MERCHANT);
      if (mi < 0) continue;
      const delta = tx.meta.postBalances[mi] - tx.meta.preBalances[mi];
      if (delta === amount) {
        return res.status(200).json({ paid: true, url: BASE + file, signature: s.signature });
      }
    }
    return res.status(200).json({ paid: false });
  } catch (e) {
    return res.status(200).json({ paid: false, note: 'retry' });
  }
};
