// src/commands/estoque.js
// Comando /estoque: mostra as contas disponiveis, publico para qualquer pessoa.

const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { loadStore } = require('../storage');

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
        ephemeral: true
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

    const embed = new EmbedBuilder()
      .setTitle(`${store.storeName} — Estoque`)
      .setDescription('Selecione um jogo abaixo para ver as contas disponíveis.')
      .setColor(store.color || '#5865F2');

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};