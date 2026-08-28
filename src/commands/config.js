// src/commands/config.js
// Comando /config: abre o painel de configuracao da loja (apenas staff).
// Usa Components V2: Container (visual de embed com cor da loja) + TextDisplay +
// Separator + Section (texto com o menu/acessório colado à direita).

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { loadStore } = require('../storage');
const { v2Container } = require('../utils/v2');

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
        { label: 'Cargos Automáticos', value: 'cargos', emoji: '🏷️', description: 'Cargo de Novo Cliente (1º ticket) e Comprador (1ª compra)' },
        { label: 'Personalização', value: 'personalizacao', emoji: '🎨', description: 'Nome do bot, nome da loja, cor e imagens' }
      ]);

    const container = v2Container(store, {
      title: '⚙️ Configuração da Loja',
      description:
        `- **Configuração de vendas:** adicione produtos, preços e estoque.\n` +
        `- **Configuração de tickets:** setar o canal de suporte.\n` +
        `- **Configuração de logs:** setar os canais de log públicos e privados.\n` +
        `- **Cargos automáticos:** cargo de Novo Cliente e Comprador.\n` +
        `- **Personalização:** personalize o nome do bot, da loja e escolha a cor.`,
      rows: [new ActionRowBuilder().addComponents(menu)]
    });

    await interaction.reply({
      components: [container],
      flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]
    });
  }
};