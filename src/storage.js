// src/storage.js
// Responsavel por salvar e carregar os dados da loja em arquivos JSON.
// Cada servidor (guild) tem seu proprio arquivo em /data/<guildId>.json
// O caminho pode ser sobrescrito via env DATA_DIR (usado no Fly.io para
// apontar para o volume persistente montado em /data).

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Estrutura padrao de uma loja nova
function defaultStore() {
  return {
    storeName: 'Innova Forn',
    botName: 'Innova Forn',
    color: '#5865F2',
    logoUrl: null,
    images: {
      product: null, // imagem padrao dos cards de produto
      ticket: null,  // imagem do painel de suporte
      logs: null     // imagem dos logs privados
    },
    sales: {
      products: [],   // { id, name, game, price, stock, channelId, imageUrl, description }
      sendTimes: [],  // ex: ["09:00", "18:00"]
      sendChannelIds: [],
      history: []     // compras finalizadas: { id, buyerId, buyerTag, productId, productName, quantity, initialValue, discount, finalValue, couponCode, paymentMethod, accountUsername, referenceImage, date }
    },
    ticket: {
      panelChannelId: null,
      pendingMinutes: 30 // prazo em minutos para pagamento pendente
    },
    logs: {
      privateChannelId: null,
      publicChannelId: null
    },
    balances: {},   // userId -> saldo em reais
    coupons: [],    // { id, code, type: 'percent'|'fixed', value, uses, maxUses, expiresAt }
    pendings: [],   // vendas aguardando pagamento: { id, threadId, guildId, userId, productId, quantity, initialValue, discount, finalValue, couponCode, accountUsername, referenceImage, expiresAt }
    pixKey: null,   // chave Pix exibida nas vendas pendentes
    panelMessageId: null
  };
}

function getFilePath(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

// Caminho base dos dados. Exportado para modulos externos (ex: backups.js)
// poderem acessar outros arquivos dentro de DATA_DIR sem duplicar a env var.
function getDataDir() {
  return DATA_DIR;
}

function loadStore(guildId) {
  const filePath = getFilePath(guildId);
  if (!fs.existsSync(filePath)) {
    const store = defaultStore();
    saveStore(guildId, store);
    return store;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    return migrarCamposFaltantes(parsed);
  } catch (err) {
    console.error(`Erro ao ler o arquivo de dados de ${guildId}, recriando com padrao.`, err);
    const store = defaultStore();
    saveStore(guildId, store);
    return store;
  }
}

// Preenche campos novos que arquivos antigos nao tem, para nao quebrar lojas ja configuradas.
function migrarCamposFaltantes(store) {
  const d = defaultStore();
  if (store.logoUrl === undefined) store.logoUrl = d.logoUrl;
  if (!store.images) store.images = d.images;
  if (store.sales) {
    if (store.sales.products && Array.isArray(store.sales.products)) {
      for (const p of store.sales.products) {
        if (p.imageUrl === undefined) p.imageUrl = null;
        if (p.description === undefined) p.description = null;
      }
    }
    if (!Array.isArray(store.sales.sendChannelIds)) store.sales.sendChannelIds = [];
    if (!Array.isArray(store.sales.history)) store.sales.history = [];
  }
  if (!store.balances) store.balances = {};
  if (!Array.isArray(store.coupons)) store.coupons = [];
  if (!Array.isArray(store.pendings)) store.pendings = [];
  if (store.pixKey === undefined) store.pixKey = null;
  if (store.ticket && store.ticket.pendingMinutes === undefined) store.ticket.pendingMinutes = 30;
  return store;
}

function saveStore(guildId, store) {
  const filePath = getFilePath(guildId);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// Gera um ID curto e unico para produtos/tickets
function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

// Gera um ID de compra no estilo da referencia: letras e numeros curtos
function generatePurchaseId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function getBalance(store, userId) {
  return store.balances[userId] || 0;
}

function addBalance(store, userId, amount) {
  store.balances[userId] = Math.max(0, (store.balances[userId] || 0) + amount);
}

module.exports = {
  loadStore,
  saveStore,
  getDataDir,
  generateId,
  generatePurchaseId,
  defaultStore,
  getBalance,
  addBalance
};