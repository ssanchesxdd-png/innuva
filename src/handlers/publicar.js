// src/handlers/publicar.js
// Sincroniza os cards de produto nos canais de envio configurados:
// - envia card novo se ainda nao existir naquele canal
// - edita o card existente (preco, estoque, imagem, cor atualizados)
// - deleta cards de produtos que foram removidos da loja
// Resultado: o canal de vendas fica sempre espelhando o estoque, e o cliente
// so precisa clicar em "🛒 Comprar" — sem digitar nenhum comando.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadStore, saveStore } = require('../storage');
const { productCardEmbed } = require('../utils/embeds');

function cardRow(produto) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`publico:comprar_produto:${produto.id}`)
      .setLabel('Comprar')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🛒')
  );
}

// Publica/atualiza todos os cards nos canais de envio.
// Retorna { enviados, editados, removidos } ou null se nao ha canais configurados.
async function publicarCards(guild) {
  const store = loadStore(guild.id);
  const canais = store.sales.sendChannelIds || [];
  const produtos = store.sales.products;
  const registros = store.sales.cardMessages || (store.sales.cardMessages = []);

  if (canais.length === 0) return null;

  let enviados = 0;
  let editados = 0;
  let removidos = 0;

  for (const canalId of canais) {
    const canal = await guild.channels.fetch(canalId).catch(() => null);
    if (!canal) continue;

    for (const produto of produtos) {
      const reg = registros.find(r => r.productId === produto.id && r.channelId === canalId);

      if (reg) {
        const msg = await canal.messages.fetch(reg.messageId).catch(() => null);
        if (msg) {
          await msg.edit({ embeds: [productCardEmbed(store, produto)], components: [cardRow(produto)] }).catch(() => {});
          editados++;
          continue;
        }
        // Card apagado manualmente no canal: envia de novo
        const nova = await canal.send({ embeds: [productCardEmbed(store, produto)], components: [cardRow(produto)] }).catch(() => null);
        if (nova) {
          reg.messageId = nova.id;
          enviados++;
        }
      } else {
        const msg = await canal.send({ embeds: [productCardEmbed(store, produto)], components: [cardRow(produto)] }).catch(() => null);
        if (msg) {
          registros.push({ productId: produto.id, channelId: canalId, messageId: msg.id });
          enviados++;
        }
      }
    }
  }

  // Cards de produtos que nao existem mais: deleta e desregistra
  for (const reg of [...registros]) {
    if (!produtos.some(p => p.id === reg.productId)) {
      const canal = await guild.channels.fetch(reg.channelId).catch(() => null);
      if (canal) {
        const msg = await canal.messages.fetch(reg.messageId).catch(() => null);
        if (msg) {
          await msg.delete().catch(() => {});
          removidos++;
        }
      }
      registros.splice(registros.indexOf(reg), 1);
    }
  }

  saveStore(guild.id, store);
  return { enviados, editados, removidos };
}

module.exports = { publicarCards, cardRow };