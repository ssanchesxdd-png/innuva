// src/handlers/roles.js
// Concessao automatica de cargos por evento:
// - "novoCliente": usuario abriu um ticket pela primeira vez
// - "comprador": usuario concluiu a primeira compra (pagamento aprovado)
// Os cargos sao configurados por servidor em /config > Cargos Automaticos
// e ficam salvos em store.roles. O controle de quem ja e cliente fica em
// store.clientes (userId -> { primeiroTicketEm, primeiraCompraEm }).

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { saveStore } = require('../storage');
const { privateLogContainer } = require('../utils/embeds');

const TIPOS_CARGO = {
  novoCliente: 'Novo Cliente',
  comprador: 'Comprador'
};

// Garante o registro do cliente e retorna true se ele for novo no controle
function registrarCliente(store, userId) {
  if (!store.clientes) store.clientes = {};
  if (!store.clientes[userId]) {
    store.clientes[userId] = { primeiroTicketEm: null, primeiraCompraEm: null };
    return true;
  }
  return false;
}

// Concede o cargo do tipo ao membro, se estiver configurado.
// Erros (hierarquia/permissao) nao derrubam o fluxo da venda — so sao logados.
async function concederCargo(guild, store, userId, tipo) {
  const roleId = store.roles?.[tipo];
  if (!roleId) return false;
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.roles.cache.has(roleId)) return false;
    await member.roles.add(roleId, `Concessao automatica: cargo ${TIPOS_CARGO[tipo]}`);
    return true;
  } catch (err) {
    console.error(`[cargos] Falha ao conceder cargo "${tipo}" para ${userId}:`, err.message);
    return false;
  }
}

// Primeiro ticket aberto pelo usuario
async function aoAbrirPrimeiroTicket(guild, store, userId) {
  const novo = registrarCliente(store, userId);
  if (!novo) return;
  store.clientes[userId].primeiroTicketEm = Date.now();
  const concedido = await concederCargo(guild, store, userId, 'novoCliente');
  saveStore(guild.id, store);
  if (concedido) {
    await avisar(guild, store, userId, 'novoCliente');
  }
}

// Primeira compra concluida (pagamento aprovado)
async function aoConcluirPrimeiraCompra(guild, store, userId) {
  registrarCliente(store, userId);
  if (!store.clientes[userId].primeiraCompraEm) {
    store.clientes[userId].primeiraCompraEm = Date.now();
  }
  const concedido = await concederCargo(guild, store, userId, 'comprador');
  saveStore(guild.id, store);
  if (concedido) {
    await avisar(guild, store, userId, 'comprador');
  }
}

// Log privado + DM avisando do cargo recebido
async function avisar(guild, store, userId, tipo) {
  const nome = TIPOS_CARGO[tipo];
  if (store.logs.privateChannelId) {
    const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logContainer = privateLogContainer(
        store,
        `🏷️ Cargo automático concedido — ${nome}`,
        `**Membro:** <@${userId}>\n` +
        `**Motivo:** ${tipo === 'novoCliente' ? 'abriu o primeiro ticket' : 'concluiu a primeira compra'}`
      );
      await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
    }
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member && typeof member.send === 'function') {
    await member.send({
      components: [
        new ContainerBuilder()
          .setAccentColor(0x23A55A)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**🏷️ Você recebeu um cargo — ${store.storeName}**\n\n` +
              `Parabéns <@${userId}>! Você acaba de ganhar o cargo **${nome}**.` +
              (tipo === 'comprador' ? '\n\nObrigado pela sua primeira compra! ❤️' : '')
            )
          )
      ],
      flags: [MessageFlags.IsComponentsV2]
    }).catch(() => {});
  }
}

module.exports = {
  aoAbrirPrimeiroTicket,
  aoConcluirPrimeiraCompra,
  registrarCliente
};
