// src/commands/estoque.js
// Comando /estoque: mostra as contas disponiveis, publico para qualquer pessoa.

const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require('discord.js');
const { loadStore } = require('../storage');
const { v2Info } = require('../utils/v2');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('estoque')
    .setDescription('Mostra as contas disponiveis para compra.'),

  async execute(interaction) {
    const store = loadStore(interaction.guildId);
    const jogos = [...new Set(store.sales.products.map(p => p.game))];

    if (jogos.length === 0) {
      return interaction.reply({
        content: 'Ainda não há produtos cadastrados. Peça para a staff configurar com `/config`.',
        flags: MessageFlags.Ephemeral
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('estoque:selecionar_jogo')
      .setPlaceholder('Selecione um jogo para ver o estoque')
      .addOptions(jogos.map(g => ({
        label: g,
        value: g,
        emoji: '🎮'
      })));
    const row = new ActionRowBuilder().addComponents(menu);

    const container = v2Info(store, {
      title: `${store.storeName} — Estoque`,
      description: 'Selecione um jogo abaixo para ver as contas disponíveis.',
      rows: [row]
    });

    await interaction.reply({ components: [container], flags: [MessageFlags.IsComponentsV2] });
  }
};
