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
      pendingMinutes: 30, // prazo em minutos para pagamento pendente
      categories: {
        suporte: null,  // ID da categoria onde abrem tickets de Suporte & Dúvidas
        compras: null   // ID da categoria onde abrem tickets de Compras
      },
      closeWindowMinutes: 10, // prazo em minutos para o cliente encerrar o proprio ticket
      faq: [],
      open: {}        // channelId -> { userId, tipoId, openedAt } dos tickets abertos
    },
    logs: {
      privateChannelId: null,
      publicChannelId: null
    },
    coupons: [],    // { id, code, type: 'percent'|'fixed', value, uses, maxUses, expiresAt }
    pendings: [],   // vendas aguardando pagamento: { id, threadId, guildId, userId, productId, quantity, initialValue, discount, finalValue, couponCode, accountUsername, referenceImage, expiresAt }
    pixKey: null,   // chave Pix exibida nas vendas pendentes
    avaliacoes: {}, // userId -> { notas: [{ texto, estrelas, staffId, staffTag, channelId, date }], estrelas: { soma, votos }, votosNotas: [{ staffId, staffTag, voto, estrelas, date }] }
    roles: {
      primeiraCompra: null, // cargo concedido ao concluir a primeira compra
      novoMembro: null      // cargo concedido ao entrar no servidor
    },
    clientes: {},   // userId -> { primeiroTicketEm, primeiraCompraEm }
    panelMessageId: null
  };
}

function getFilePath(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

// Caminho base dos dados. Exportado para o modulo de backups acessar
// snapshots dentro de DATA_DIR sem duplicar a env var.
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
  if (!store.avaliacoes) store.avaliacoes = {};
  if (!store.roles) store.roles = { primeiraCompra: null, novoMembro: null };
  // Migracao da versao antiga (novoCliente/comprador por ticket/compra)
  if (store.roles.primeiraCompra === undefined) store.roles.primeiraCompra = store.roles.comprador ?? null;
  if (store.roles.novoMembro === undefined) store.roles.novoMembro = null;
  delete store.roles.novoCliente;
  delete store.roles.comprador;
  if (!store.clientes) store.clientes = {};
  if (store.ticket && store.ticket.pendingMinutes === undefined) store.ticket.pendingMinutes = 30;
  if (store.ticket && !store.ticket.categories) store.ticket.categories = { suporte: null, compras: null };
  if (store.ticket && !store.ticket.open) store.ticket.open = {};
  if (store.ticket && !Array.isArray(store.ticket.faq)) store.ticket.faq = [
    { id: generateId('faq_'), pergunta: '📦 Como recebo minha conta?', resposta: 'Assim que o pagamento é confirmado, a staff entrega o login e a senha da sua conta aqui mesmo no ticket — normalmente em poucos minutos.' },
    { id: generateId('faq_'), pergunta: '⏱️ Qual o prazo de entrega?', resposta: 'As entregas são feitas manualmente pela staff após a confirmação do pagamento. Na maioria dos casos, em poucos minutos!' },
    { id: generateId('faq_'), pergunta: '🛡️ E se a conta tiver algum problema?', resposta: 'Em caso de qualquer problema com a conta entregue, fale com a staff aqui mesmo — resolvemos trocando a conta ou compensando.' },
    { id: generateId('faq_'), pergunta: '💳 Quais as formas de pagamento?', resposta: 'Aceitamos pagamento via Pix. O comprovante é analisado pela staff e a entrega acontece logo após a confirmação.' }
  ];
  if (store.ticket && store.ticket.closeWindowMinutes === undefined) store.ticket.closeWindowMinutes = 10;
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

module.exports = {
  loadStore,
  saveStore,
  getDataDir,
  generateId,
  generatePurchaseId,
  defaultStore,
  migrarCamposFaltantes
};
