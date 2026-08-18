// src/handlers/coupons.js
// Logica de cupons: criar, validar, aplicar desconto e deletar.

const { generateId } = require('../storage');

function gerarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Cria um cupom. code opcional (gera automatico), type percent|fixed, value, maxUses, expiresAt DD/MM/AAAA
function criarCupom(store, { code, type, value, maxUses = 0, expiresAt = null }) {
  const codigo = (code || '').toUpperCase().trim() || gerarCodigo();

  if (!/^[A-Z0-9]{1,20}$/.test(codigo)) {
    return { ok: false, error: 'Código inválido. Use apenas letras e números, sem espaços (máx. 20).' };
  }

  if (store.coupons.some(c => c.code === codigo)) {
    return { ok: false, error: `Já existe um cupom com o código \`${codigo}\`.` };
  }

  if (!value || value <= 0) {
    return { ok: false, error: 'O valor do desconto deve ser maior que zero.' };
  }

  if (type === 'percent' && value > 100) {
    return { ok: false, error: 'Desconto percentual não pode passar de 100%.' };
  }

  let expiraTs = null;
  if (expiresAt) {
    const m = expiresAt.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) {
      return { ok: false, error: 'Data inválida. Use o formato DD/MM/AAAA.' };
    }
    expiraTs = new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`).getTime();
    if (isNaN(expiraTs)) {
      return { ok: false, error: 'Data inválida. Use o formato DD/MM/AAAA.' };
    }
  }

  const cupom = {
    id: generateId('cup_'),
    code: codigo,
    type,
    value,
    uses: 0,
    maxUses: Math.floor(maxUses) || 0,
    expiresAt: expiraTs
  };

  store.coupons.push(cupom);
  return { ok: true, cupom };
}

// Valida e calcula o desconto. Retorna { ok, discount, error }
function aplicarCupom(store, code) {
  if (!code) return { ok: false, discount: 0 };

  const cupom = store.coupons.find(c => c.code === code.toUpperCase().trim());
  if (!cupom) return { ok: false, error: 'Cupom inválido ou não encontrado.' };

  if (cupom.expiresAt && Date.now() > cupom.expiresAt) {
    return { ok: false, error: 'Cupom expirado.' };
  }

  if (cupom.maxUses > 0 && cupom.uses >= cupom.maxUses) {
    return { ok: false, error: 'Cupom sem usos restantes.' };
  }

  return { ok: true, cupom };
}

function calcularDesconto(cupom, valorBase) {
  if (cupom.type === 'percent') {
    return valorBase * (cupom.value / 100);
  }
  return Math.min(cupom.value, valorBase);
}

// Marca 1 uso do cupom (chamar so quando a venda for confirmada)
function registrarUso(store, code) {
  const cupom = store.coupons.find(c => c.code === (code || '').toUpperCase().trim());
  if (cupom) {
    cupom.uses += 1;
    return true;
  }
  return false;
}

function deletarCupom(store, code) {
  const idx = store.coupons.findIndex(c => c.code === (code || '').toUpperCase().trim());
  if (idx === -1) return false;
  store.coupons.splice(idx, 1);
  return true;
}

module.exports = {
  criarCupom,
  aplicarCupom,
  calcularDesconto,
  registrarUso,
  deletarCupom
};