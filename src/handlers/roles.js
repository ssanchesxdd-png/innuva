// src/handlers/roles.js
// Concessao automatica de cargos por evento:
// - "primeiraCompra": usuario concluiu a primeira compra (pagamento aprovado)
// - "novoMembro": membro entrou no servidor do Discord (guildMemberAdd)
// Os cargos sao configurados por servidor em /config > Cargos Automaticos
// e ficam salvos em store.roles. O controle de quem ja comprou fica em
// store.clientes (userId -> { primeiraCompraEm }).

const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { saveStore, loadStore } = require('../storage');
const { privateLogContainer } = require('../utils/embeds');

const TIPOS_CARGO = {
  primeiraCompra: 'Comprador',
  novoMembro: 'Novo Membro'
};

// Garante o registro do cliente e retorna true se ele for novo no controle
function registrarCliente(store, userId) {
  if (!store.clientes) store.clientes = {};
  if (!store.clientes[userId]) {
    store.clientes[userId] = { primeiraCompraEm: null };
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

// Primeira compra concluida (pagamento aprovado)
async function aoConcluirPrimeiraCompra(guild, store, userId) {
  registrarCliente(store, userId);
  if (!store.clientes[userId].primeiraCompraEm) {
    store.clientes[userId].primeiraCompraEm = Date.now();
  }
  const concedido = await concederCargo(guild, store, userId, 'primeiraCompra');
  saveStore(guild.id, store);
  if (concedido) {
    await avisarCompra(guild, store, userId);
  }
}

// Novo membro entrou no servidor (cargo de boas-vindas)
async function aoEntrarNovoMembro(guild, member) {
  if (member.user.bot) return;
  const store = loadStore(guild.id);
  const roleId = store.roles?.novoMembro;
  if (!roleId) return;
  try {
    if (member.roles.cache.has(roleId)) return;
    await member.roles.add(roleId, 'Concessao automatica: cargo Novo Membro');
    if (store.logs.privateChannelId) {
      const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
      if (logChannel) {
        const logContainer = privateLogContainer(
          store,
          '🏷️ Cargo automático concedido — Novo Membro',
          `**Membro:** <@${member.id}> (${member.user.tag})\n` +
          `**Motivo:** entrou no servidor`
        );
        await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[cargos] Falha ao conceder cargo "novoMembro" para ${member.id}:`, err.message);
  }
}

// Log privado + DM avisando do cargo de comprador
async function avisarCompra(guild, store, userId) {
  if (store.logs.privateChannelId) {
    const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logContainer = privateLogContainer(
        store,
        '🏷️ Cargo automático concedido — Comprador',
        `**Membro:** <@${userId}>\n` +
        `**Motivo:** concluiu a primeira compra`
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
              `Parabéns <@${userId}>! Você acaba de ganhar o cargo **Comprador**.\n\n` +
              `Obrigado pela sua primeira compra! ❤️`
            )
          )
      ],
      flags: [MessageFlags.IsComponentsV2]
    }).catch(() => {});
  }
}

module.exports = {
  aoConcluirPrimeiraCompra,
  aoEntrarNovoMembro,
  registrarCliente
};
