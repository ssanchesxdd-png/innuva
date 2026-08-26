// src/commands/backup.js
// Comando /backup (staff): cria, lista e baixa snapshots dos dados da loja.
// Os snapshots ficam no volume persistente do Fly.io em /data/backups/<guildId>/
// e a rotina diaria (03:00, fuso de Sao Paulo) roda automaticamente pelo scheduler.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const { loadStore } = require('../storage');
const { fazerBackup, listarBackups, lerBackup, RETENCAO_DIAS } = require('../handlers/backups');

function isStaff(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const staffRoles = (process.env.STAFF_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return staffRoles.some(roleId => member.roles.cache.has(roleId));
}

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function dataHoraNome(fileName) {
  // backup-2026-08-26-0300-diario.json -> 26/08/2026 as 03:00
  const m = fileName.match(/^backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
  if (!m) return fileName;
  return `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Backup dos dados da loja (apenas staff).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('Cria um snapshot agora mesmo com os dados atuais da loja.'))
    .addSubcommand(sub =>
      sub.setName('listar')
        .setDescription(`Lista os snapshots salvos (retido por ${RETENCAO_DIAS} dias).`))
    .addSubcommand(sub =>
      sub.setName('enviar')
        .setDescription('Baixa um snapshot como arquivo .json.')
        .addStringOption(opt =>
          opt.setName('arquivo')
            .setDescription('Nome exato do snapshot (veja /backup listar). Vazio = o mais recente')
            .setRequired(false))),

  async execute(interaction) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();
    const store = loadStore(interaction.guildId);

    if (sub === 'criar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const r = fazerBackup(interaction.guildId, { motivo: 'manual' });
      if (!r.ok) {
        return interaction.editReply({ content: `❌ ${r.error}` });
      }

      const total = listarBackups(interaction.guildId).length;
      const embed = new EmbedBuilder()
        .setTitle('💾 Backup criado com sucesso!')
        .setDescription(
          `**Arquivo:** \`${r.fileName}\`\n` +
          `**Tamanho:** ${fmtKB(r.sizeBytes)}\n` +
          `**Snapshots guardados:** ${total} (retidos por ${RETENCAO_DIAS} dias)\n\n` +
          `Use \`/restaurar snapshot\` se precisar voltar o estado atual de qualquer produto, saldo ou cupom.`
        )
        .setColor('#23A55A')
        .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'listar') {
      const backups = listarBackups(interaction.guildId);
      const embed = new EmbedBuilder()
        .setTitle('🗄️ Snapshots de Backup')
        .setColor(store.color || '#5865F2')
        .setFooter({ text: store.storeName, iconURL: store.logoUrl || undefined })
        .setTimestamp();

      if (backups.length === 0) {
        embed.setDescription('Nenhum snapshot ainda. Use `/backup criar` — e um é gerado automaticamente todo dia às 03:00.');
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      const linhas = backups.slice(0, 15).map(b => `• \`${b.fileName}\` — ${fmtKB(b.sizeBytes)} · ${dataHoraNome(b.fileName)}`);
      embed.setDescription(linhas.join('\n'));
      if (backups.length > 15) embed.addFields({ name: '…', value: `${backups.length - 15} snapshots antigos também disponíveis.` });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'enviar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let nomeEscolhido = interaction.options.getString('arquivo');
      if (!nomeEscolhido) {
        const lista = listarBackups(interaction.guildId);
        if (lista.length === 0) {
          return interaction.editReply({ content: '❌ Nenhum snapshot ainda. Use `/backup criar` primeiro.' });
        }
        nomeEscolhido = lista[0].fileName;
      }

      const r = lerBackup(interaction.guildId, nomeEscolhido);
      if (!r.ok) {
        return interaction.editReply({ content: `❌ ${r.error}` });
      }

      const arquivo = new AttachmentBuilder(Buffer.from(JSON.stringify(r.dados, null, 2)), { name: nomeEscolhido });
      return interaction.editReply({
        content: `📤 Snapshot \`${nomeEscolhido}\`:`,
        files: [arquivo]
      });
    }
  }
};