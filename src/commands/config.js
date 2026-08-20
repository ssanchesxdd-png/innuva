// src/commands/config.js
// Comando /config: abre o painel de configuracao da loja (apenas staff).

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');
const { loadStore } = require('../storage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Abre o painel de configuracao da loja (apenas staff).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const store = loadStore(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuração da Loja')
      .setDescription(
        `**CONFIGURAÇÃO DA LOJA**\n\n` +
        `- **Configuração de vendas:** adicione produtos, preços e estoque.\n` +
        `- **Configuração de tickets:** setar o canal de suporte.\n` +
        `- **Configurar logs:** setar os canais de log públicos e privados.\n` +
        `- **Personalização:** personalize o nome do bot, da loja e escolha a cor de acordo com o tema que quiser.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Selecione uma categoria abaixo ⬇️`
      )
      .setColor(store.color || '#5865F2')
      .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
      .setTimestamp();

    const menu = new StringSelectMenuBuilder()
      .setCustomId('config:menu:root')
      .setPlaceholder('Selecione uma categoria')
      .addOptions([
        { label: 'Configurações de Vendas', value: 'vendas', emoji: '💰', description: 'Produtos, preços, estoque, canais e horários' },
        { label: 'Configurações de Ticket', value: 'ticket', emoji: '🎫', description: 'Canal do painel de suporte/ticket' },
        { label: 'Configurações de Logs', value: 'logs', emoji: '📋', description: 'Canais de log privado e público' },
        { label: 'Personalização', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, nome da loja, cor e imagens' }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }
};