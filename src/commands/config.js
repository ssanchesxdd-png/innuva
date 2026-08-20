// src/commands/config.js
// Comando /config: abre o painel de configuracao da loja (apenas staff).
// Usa Components V2: Container (visual de embed com cor da loja) + TextDisplay + Separator.

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
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

    const menu = new StringSelectMenuBuilder()
      .setCustomId('config:menu:root')
      .setPlaceholder('Selecione uma categoria')
      .addOptions([
        { label: 'Configurações de Vendas', value: 'vendas', emoji: '💰', description: 'Produtos, preços, estoque, canais e horários' },
        { label: 'Configurações de Ticket', value: 'ticket', emoji: '🎫', description: 'Canal do painel de suporte/ticket' },
        { label: 'Configurações de Logs', value: 'logs', emoji: '📋', description: 'Canais de log privado e público' },
        { label: 'Personalização', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, nome da loja, cor e imagens' }
      ]);

    const container = new ContainerBuilder()
      .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**⚙️ Configuração da Loja**\n\n' +
          `- **Configuração de vendas:** adicione produtos, preços e estoque.\n` +
          `- **Configuração de tickets:** setar o canal de suporte.\n` +
          `- **Configurar logs:** setar os canais de log públicos e privados.\n` +
          `- **Personalização:** personalize o nome do bot, da loja e escolha a cor de acordo com o tema que quiser.`
        )
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addActionRowComponents(new ActionRowBuilder().addComponents(menu));

    await interaction.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]
    });
  }
};