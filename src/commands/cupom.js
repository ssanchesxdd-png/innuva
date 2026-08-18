// src/commands/cupom.js
// Comando /cupom (staff): criar, listar e deletar cupons de desconto.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { loadStore, saveStore, generateId } = require('../storage');
const { couponListEmbed } = require('../utils/embeds');
const { criarCupom, deletarCupom, listarCupons } = require('../handlers/coupons');

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoles = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return staffRoles.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cupom')
    .setDescription('Gerencia cupons de desconto (apenas staff).')
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('Cria um cupom de desconto.')
        .addStringOption(opt =>
          opt.setName('tipo')
            .setDescription('Tipo do desconto')
            .setRequired(true)
            .addChoices(
              { name: 'Percentual (%)', value: 'percent' },
              { name: 'Valor fixo (R$)', value: 'fixed' }
            ))
        .addNumberOption(opt =>
          opt.setName('valor')
            .setDescription('Valor do desconto (ex: 10 para 10% ou R$ 10,00)')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('codigo')
            .setDescription('Código do cupom (letras/números). Vazio = gerado automático')
            .setRequired(false))
        .addNumberOption(opt =>
          opt.setName('usos')
            .setDescription('Usos máximos (0 = ilimitado)')
            .setRequired(false))
        .addStringOption(opt =>
          opt.setName('expira')
            .setDescription('Data de expiração no formato DD/MM/AAAA (opcional)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('listar')
        .setDescription('Lista todos os cupons cadastrados.'))
    .addSubcommand(sub =>
      sub.setName('deletar')
        .setDescription('Deleta um cupom.')
        .addStringOption(opt =>
          opt.setName('codigo')
            .setDescription('Código do cupom a deletar')
            .setRequired(true))),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const store = loadStore(interaction.guildId);

    if (sub === 'criar') {
      const resultado = criarCupom(store, {
        code: interaction.options.getString('codigo'),
        type: interaction.options.getString('tipo'),
        value: interaction.options.getNumber('valor'),
        maxUses: interaction.options.getNumber('usos') || 0,
        expiresAt: interaction.options.getString('expira')
      });

      if (!resultado.ok) {
        return interaction.reply({ content: `❌ ${resultado.error}`, ephemeral: true });
      }

      saveStore(interaction.guildId, store);
      const c = resultado.cupom;
      const desconto = c.type === 'percent' ? `${c.value}%` : `R$ ${c.value.toFixed(2)}`;

      const embed = new EmbedBuilder()
        .setTitle('🎟️ Cupom criado com sucesso!')
        .setDescription(
          `**Código:** \`${c.code}\`\n` +
          `**Desconto:** ${desconto}\n` +
          `**Usos:** ${c.uses} / ${c.maxUses > 0 ? c.maxUses : '∞'}\n` +
          (c.expiresAt ? `**Expira:** ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}` : '**Expira:** nunca')
        )
        .setColor('#5865F2')
        .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'listar') {
      const embed = couponListEmbed(store);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'deletar') {
      const code = interaction.options.getString('codigo').toUpperCase();
      const resultado = deletarCupom(store, code);

      if (!resultado) {
        return interaction.reply({ content: `❌ Cupom \`${code}\` não encontrado.`, ephemeral: true });
      }

      saveStore(interaction.guildId, store);
      return interaction.reply({ content: `🗑️ Cupom \`${code}\` deletado com sucesso.`, ephemeral: true });
    }
  }
};