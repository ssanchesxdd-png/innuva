// server.js
// Servidor HTTP do innuva com duas funcoes:
// 1. Keep-alive / health check (hospedagem: Fly.io, UptimeRobot, etc.)
// 2. PONTE SubBot -> innuva: POST /api/coupons cria um cupom REAL na loja
//    quando alguem ganha um premio no bot subbot.
//    Seguranca: exige o header x-bridge-secret igual a env BRIDGE_SECRET.

require('dotenv').config();
const http = require('http');
const { loadStore, saveStore } = require('./src/storage');
const { criarCupom } = require('./src/handlers/coupons');

const port = process.env.PORT || 3000;

// Le e faz parse do corpo JSON de uma requisicao
function lerBodyJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100 * 1024) { // protecao contra corpo gigante
        reject(new Error('Corpo da requisicao muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        reject(new Error('JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // ---- PONTE: criacao de cupom pelo subbot ----
  if (req.method === 'POST' && req.url === '/api/coupons') {
    // Autenticacao por segredo compartilhado
    if (!process.env.BRIDGE_SECRET || req.headers['x-bridge-secret'] !== process.env.BRIDGE_SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'Segredo da ponte invalido ou ausente.' }));
    }

    try {
      const body = await lerBodyJson(req);
      const guildId = String(body.guildId || '');
      if (!guildId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'guildId obrigatoria.' }));
      }

      const store = loadStore(guildId);
      const resultado = criarCupom(store, {
        code: body.code,                       // opcional (gera automatico)
        type: body.type,                       // 'percent' | 'fixed'
        value: Number(body.value),
        maxUses: Number(body.maxUses) || 1,
        expiresAt: body.expiresAt              // 'DD/MM/AAAA' ou null
      });

      if (!resultado.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: resultado.error }));
      }

      saveStore(guildId, store);
      console.log(`[bridge] Cupom criado: ${resultado.cupom.code} (${resultado.cupom.type} ${resultado.cupom.value}) — motivo: ${body.motivo || 'n/a'}`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, cupom: resultado.cupom }));
    } catch (err) {
      const status = err.message === 'JSON invalido.' ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // ---- Keep-alive / health check ----
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Bot ${process.env.BOT_NAME || 'Innova Forn'} online!`);
});

server.listen(port, () => {
  console.log(`🔄 Servidor keep-alive rodando na porta ${port}`);
});
