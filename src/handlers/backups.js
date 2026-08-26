// src/handlers/backups.js
// Sistema de backup dos dados da loja:
// - Copia o arquivo atual de cada servidor para /data/backups/<guildId>/
// - Usado pelo comando /backup (snapshot manual), pelo /restaurar (que sempre
//   salva um "pre-restauracao" antes de sobrescrever) e pela rotina diaria
//   agendada no scheduler.js.
//
// Formato do nome do arquivo: backup-<AAAA-MM-DD>-<HHmm>-<motivo>.json
// A data/hora usa sempre o fuso de America/Sao_Paulo, independente do fuso
// do servidor onde o bot roda (no Fly.io o container vive em UTC).

const fs = require('fs');
const path = require('path');
const { getDataDir, saveStore } = require('../storage');

// Quantos dias os snapshots ficam guardados antes da limpeza automatica
const RETENCAO_DIAS = 30;

function pastaBackups(guildId) {
  return path.join(getDataDir(), 'backups', guildId);
}

// Data e hora formatadas no fuso de Sao Paulo
function timestampSP(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const partes = {};
  for (const p of fmt.formatToParts(date)) partes[p.type] = p.value;
  return {
    dia: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}${partes.minute}`
  };
}

// Remove snapshots com mais de RETENCAO_DIAS dias
function limparAntigos(guildId) {
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  for (const arq of listarBackups(guildId)) {
    if (arq.mtimeMs < limite) {
      try { fs.unlinkSync(path.join(pastaBackups(guildId), arq.fileName)); } catch (_) {}
    }
  }
}

// Gera um snapshot do estado ATUAL no disco. Propositalmente NAO usa loadStore():
// assim copiamos o arquivo exatamente como esta salvo (mesmo se algum campo
// ainda nao passou pela migracao), sem criar lojas vazias por engano.
function fazerBackup(guildId, { motivo = 'manual' } = {}) {
  try {
    const origem = path.join(getDataDir(), `${guildId}.json`);
    if (!fs.existsSync(origem)) {
      return { ok: false, error: 'Essa loja ainda nao possui dados salvos.' };
    }

    fs.mkdirSync(pastaBackups(guildId), { recursive: true });

    const ts = timestampSP();
    const nome = `backup-${ts.dia}-${ts.hora}-${motivo}.json`;
    const destino = path.join(pastaBackups(guildId), nome);

    fs.copyFileSync(origem, destino);
    limparAntigos(guildId);

    return { ok: true, fileName: nome, sizeBytes: fs.statSync(destino).size };
  } catch (err) {
    console.error('[backup] Erro ao gerar snapshot:', err.message);
    return { ok: false, error: err.message };
  }
}

// Lista os snapshots do servidor, mais recentes primeiro
function listarBackups(guildId) {
  const dir = pastaBackups(guildId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { fileName: f, sizeBytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
}

// Le um snapshot especifico. O nome passa por sanitizacao dupla contra path traversal.
function lerBackup(guildId, fileName) {
  const seguro = typeof fileName === 'string' && /^[A-Za-z0-9._-]+$/.test(fileName);
  if (!seguro || !fileName.startsWith('backup-')) {
    return { ok: false, error: 'Nome de arquivo invalido.' };
  }

  const filePath = path.join(pastaBackups(guildId), path.basename(fileName));
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'Snapshot nao encontrado. Veja a lista com `/backup listar`.' };
  }

  try {
    return { ok: true, dados: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (err) {
    return { ok: false, error: `Snapshot corrompido: ${err.message}` };
  }
}

// Valida a estrutura de um objeto loja (vindo de snapshot ou upload).
// Retorna { ok, erros[], resumo{} }. Novos campos faltantes nao sao erro:
// o loadStore ja migra campos na proxima leitura.
function validarStore(dados) {
  const erros = [];

  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    return { ok: false, erros: ['O conteudo nao e um objeto JSON valido de loja.'] };
  }
  if (typeof dados.storeName !== 'string' || !dados.storeName.trim()) {
    erros.push('Campo obrigatorio ausente ou invalido: storeName.');
  }
  if (!dados.sales || typeof dados.sales !== 'object' || !Array.isArray(dados.sales.products)) {
    erros.push('Campo obrigatorio ausente ou invalido: sales.products.');
  }
  if (dados.balances !== undefined && (typeof dados.balances !== 'object' || dados.balances === null)) {
    erros.push('Campo invalido: balances (deve ser um objeto userId -> valor).');
  }
  if (dados.coupons !== undefined && !Array.isArray(dados.coupons)) {
    erros.push('Campo invalido: coupons (deve ser uma lista).');
  }
  if (dados.pendings !== undefined && !Array.isArray(dados.pendings)) {
    erros.push('Campo invalido: pendings (deve ser uma lista).');
  }

  const produtos = dados.sales?.products?.length || 0;
  const saldosAtivos = Object.values(dados.balances || {}).filter(v => v > 0).length;
  const resumo = {
    produtos,
    cupons: Array.isArray(dados.coupons) ? dados.coupons.length : 0,
    pendentes: Array.isArray(dados.pendings) ? dados.pendings.length : 0,
    compras: Array.isArray(dados.sales?.history) ? dados.sales.history.length : 0,
    saldosAtivos,
    ticketConfigurado: !!dados.ticket?.panelChannelId,
    pixConfigurada: !!dados.pixKey
  };

  return { ok: erros.length === 0, erros, resumo };
}

// Grava os dados validados como a loja oficial do servidor.
function aplicarRestore(guildId, dados) {
  saveStore(guildId, dados);
  return path.join(getDataDir(), `${guildId}.json`);
}

module.exports = {
  fazerBackup,
  listarBackups,
  lerBackup,
  validarStore,
  aplicarRestore,
  RETENCAO_DIAS
};