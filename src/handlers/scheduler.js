// src/handlers/scheduler.js
// Verifica a cada minuto se algum horario configurado bate com o horario atual,
// e se sim, reenvia os cards de produto (individuais) nos canais configurados.

const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadStore } = require('../storage');
const { productCardEmbed } = require('../utils/embeds');

function iniciarAgendador(client) {
  // Roda a cada minuto
  cron.schedule('* * * * *', async () => {
    const agora = new Date();
    const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

    for (const guild of client.guilds.cache.values()) {
      const store = loadStore(guild.id);
      const horarios = store.sales.sendTimes || [];
      const canais = store.sales.sendChannelIds || [];

      if (!horarios.includes(horaAtual) || canais.length === 0) continue;

      const produtosDisponiveis = store.sales.products.filter(p => p.stock > 0);
      if (produtosDisponiveis.length === 0) continue;

      for (const canalId of canais) {
        const canal = await guild.channels.fetch(canalId).catch(() => null);
        if (!canal) continue;

        for (const produto of produtosDisponiveis) {
          const embed = productCardEmbed(store, produto);
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`publico:comprar_produto:${produto.id}`)
              .setLabel('Comprar')
              .setStyle(ButtonStyle.Success)
              .setEmoji('🛒')
          );
          await canal.send({ embeds: [embed], components: [row] }).catch(err => {
            console.error(`Erro ao reenviar embed em ${canal.id}:`, err.message);
          });
        }
      }
    }
  });

  console.log('Agendador de reenvio diário iniciado.');
}

module.exports = { iniciarAgendador };