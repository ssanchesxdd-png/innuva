// src/commands/config.js
// Comando /config: abre o painel de configuracao da loja (apenas staff).

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Abre o painel de configuracao da loja (apenas staff).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuracao da Loja')
      .setDescription('Escolha uma categoria abaixo para configurar.')
      .setColor('#5865F2');

    const menu = new StringSelectMenuBuilder()
      .setCustomId('config:menu:root')
      .setPlaceholder('Selecione uma categoria')
      .addOptions([
        { label: 'Configuracoes de Vendas', value: 'vendas', emoji: '💰', description: 'Precos, canais, horarios, produtos e estoque' },
        { label: 'Configuracoes de Ticket', value: 'ticket', emoji: '🎫', description: 'Canal do painel de suporte/ticket' },
        { label: 'Configuracoes de Logs', value: 'logs', emoji: '📋', description: 'Canais de log privado e publico' },
        { label: 'Personalizacao', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, cor da loja, imagens e logo' }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }
};