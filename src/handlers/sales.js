// src/handlers/sales.js
// Fluxo de vendas: registrar pendente, aprovar pagamento, cancelar, finalizar,
// enviar recibo "Compra Aprovada", botao "Referencia" e "Comprar tambem".

const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { loadStore, saveStore, generatePurchaseId } = require('../storage');
const { publicSaleEmbed, referenciaEmbed, pendingCardEmbed, privateLogEmbed } = require('../utils/embeds');
const { registrarUso } = require('./coupons');
const { publicarCards } = require('./publicar');

// Cria a venda pendente (aguardando pagamento via Pix)
async function registrarPendente(interaction, store, sessao) {
  const prazoMin = store.ticket?.pendingMinutes || 30;
  const pending = {
    id: generatePurchaseId(),
    threadId: interaction.channel.id,
    userId: sessao.userId,
    productId: sessao.produtoId,
    productName: sessao.produtoName,
    quantity: sessao.quantidade,
    initialValue: sessao.initialValue,
    discount: sessao.discount,
    finalValue: sessao.finalValue,
    couponCode: sessao.couponCode || null,
    accountUsername: sessao.usuarioConta || null,
    referenceImage: sessao.referenciaImagem || null,
    pixKey: store.pixKey || null,
    expiresAt: Date.now() + prazoMin * 60000
  };

  store.pendings.push(pending);
  saveStore(interaction.guildId, store);

  const embed = pendingCardEmbed(store, pending);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:pagamento_aprovado:${pending.id}`)
      .setLabel('Pagamento Aprovado')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`ticket:cancelar_pendente:${pending.id}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✖️')
  );

  await interaction.update({ embeds: [embed], components: [row] });

  // DM pro cliente avisando do pagamento pendente
  const buyer = await interaction.client.users.fetch(pending.userId).catch(() => null);
  if (buyer) {
    try {
      await buyer.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`⏳ Aguardando seu pagamento — ${store.storeName}`)
            .setDescription(
              `Olá <@${pending.userId}>!\n\n` +
              `Sua compra de **${pending.productName}** (R$ ${pending.finalValue.toFixed(2)}) está aguardando pagamento.\n\n` +
              `🏦 **Chave Pix:** \`${store.pixKey || '—'}\`\n` +
              `⏰ **Prazo:** ${prazoMin} minutos\n\n` +
              `Assim que pagar, avise a staff no seu ticket.`
            )
            .setColor('#F0B232')
        ]
      }).catch(() => {});
    } catch (err) {
      // DM fechada, ignora
    }
  }

  // Log privado
  if (store.logs.privateChannelId) {
    const logChannel = await interaction.guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logEmbed = privateLogEmbed(
        store,
        '⏳ Venda pendente registrada',
        `**Comprador:** <@${pending.userId}>\n` +
        `**Produto:** ${pending.productName} x${pending.quantity}\n` +
        `**Valor:** R$ ${pending.finalValue.toFixed(2)}\n` +
        (pending.couponCode ? `**Cupom:** \`${pending.couponCode}\`\n` : '') +
        `**Prazo:** ${prazoMin} min\n` +
        `**Ticket:** <#${pending.threadId}>`
      );
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }
}

// Staff clicou em "Pagamento Aprovado" — finaliza a venda
async function pagamentoAprovado(interaction, pendingId) {
  const store = loadStore(interaction.guildId);
  const idx = store.pendings.findIndex(p => p.id === pendingId);

  if (idx === -1) {
    return interaction.update({
      content: '❌ Pendência não encontrada (pode já ter sido resolvida).',
      embeds: [],
      components: []
    });
  }

  const pending = store.pendings[idx];
  store.pendings.splice(idx, 1);

  // Registra o uso do cupom
  if (pending.couponCode) registrarUso(store, pending.couponCode);

  // Deduz o estoque (ja foi deduzido? nao: deduz aqui, na finalizacao)
  const produto = store.sales.products.find(p => p.id === pending.productId);
  if (produto) {
    produto.stock = Math.max(0, produto.stock - pending.quantity);
  }

  const compra = {
    id: pending.id,
    buyerId: pending.userId,
    buyerTag: null,
    productId: pending.productId,
    productName: pending.productName,
    quantity: pending.quantity,
    initialValue: pending.initialValue,
    discount: pending.discount,
    finalValue: pending.finalValue,
    couponCode: pending.couponCode,
    paymentMethod: 'Pix',
    accountUsername: pending.accountUsername,
    referenceImage: pending.referenceImage,
    date: Date.now()
  };

  store.sales.history.push(compra);
  saveStore(interaction.guildId, store);

  // Atualiza o card do produto nos canais de venda (estoque caiu)
  await publicarCards(interaction.guild).catch(() => {});

  await finalizarCompra(interaction, store, compra);
}

// Finaliza a compra: recibo publico + DM + log privado + arquiva thread
async function finalizarCompra(interaction, store, compra) {
  const guild = interaction.guild;

  // Recibo publico com os botoes "Comprar tambem" e "Referencia" (Components V2)
  if (store.logs.publicChannelId) {
    const publicChannel = await guild.channels.fetch(store.logs.publicChannelId).catch(() => null);
    if (publicChannel) {
      const embed = publicSaleEmbed(store, compra);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`publico:comprar_tambem:${compra.id}`)
          .setLabel('Comprar também')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🛒'),
        new ButtonBuilder()
          .setCustomId(`publico:referencia:${compra.id}`)
          .setLabel('Referência')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📄')
      );
      await publicChannel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
  }

  // DM do recibo pro cliente
  const buyer = await guild.client.users.fetch(compra.buyerId).catch(() => null);
  if (buyer) {
    try {
      await buyer.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`✅ Pagamento aprovado — ${store.storeName}`)
            .setDescription(
              `Olá **${buyer.username}**!\n\n` +
              `Seu pagamento de **R$ ${compra.finalValue.toFixed(2)}** (${compra.productName}) foi aprovado.\n` +
              `A staff vai te entregar a conta neste ticket. Obrigado pela compra! ❤️`
            )
            .setColor(store.color || '#5865F2')
        ]
      }).catch(() => {});
    } catch (err) {
      // DM fechada, ignora
    }
  }

  // Log privado
  if (store.logs.privateChannelId) {
    const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logEmbed = privateLogEmbed(
        store,
        '💰 Venda concluída',
        `**Comprador:** <@${compra.buyerId}>\n` +
        `**Produto:** ${compra.productName} x${compra.quantity}\n` +
        `**Valor:** R$ ${compra.finalValue.toFixed(2)}\n` +
        `**Pagamento:** ${compra.paymentMethod} ✅\n` +
        (compra.accountUsername ? `**Conta entregue:** \`${compra.accountUsername}\`\n` : '') +
        (compra.couponCode ? `**Cupom:** \`${compra.couponCode}\`\n` : '') +
        `**ID da Compra:** \`${compra.id}\`\n` +
        `**Ticket:** <#${compra.threadId || ''}>`
      );
      await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  await interaction.reply({ content: `✅ Pagamento aprovado! Compra **${compra.id}** finalizada.`, ephemeral: true });

  // Arquiva a thread
  if (interaction.channel?.isThread()) {
    setTimeout(() => interaction.channel.setArchived(true).catch(() => {}), 10000);
  }
}

// Staff clicou em "Cancelar" — cancela a pendencia
async function cancelarPendente(interaction, pendingId) {
  const store = loadStore(interaction.guildId);
  const idx = store.pendings.findIndex(p => p.id === pendingId);

  if (idx === -1) {
    return interaction.update({
      content: '❌ Pendência não encontrada.',
      embeds: [],
      components: []
    });
  }

  store.pendings.splice(idx, 1);
  saveStore(interaction.guildId, store);

  await interaction.update({
    content: '✖️ Venda pendente cancelada.',
    embeds: [],
    components: []
  });

  if (interaction.channel?.isThread()) {
    setTimeout(() => interaction.channel.setArchived(true).catch(() => {}), 5000);
  }
}

// Botao "Referencia" no recibo publico — resposta ephemeral so pra quem clicou
async function handleReferencia(interaction, compraId) {
  const store = loadStore(interaction.guildId);
  const compra = store.sales.history.find(c => c.id === compraId);

  if (!compra) {
    return interaction.reply({ content: '❌ Compra não encontrada.', ephemeral: true });
  }

  const embed = referenciaEmbed(store, compra);

  if (compra.referenceImage) {
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  return interaction.reply({
    content: '📄 Esta compra não possui foto de referência.',
    embeds: [embed],
    ephemeral: true
  });
}

// Botao "Comprar tambem" — abre ticket sugerindo o produto da compra
async function handleComprarTambem(interaction, compraId) {
  const store = loadStore(interaction.guildId);
  const compra = store.sales.history.find(c => c.id === compraId);
  const produto = compra ? store.sales.products.find(p => p.id === compra.productId) : null;

  const { abrirTicket } = require('./tickets');
  await abrirTicket(interaction, store, produto ? produto.name : (compra ? compra.productName : null));
}

// Verifica pendentes expirados (rodado a cada minuto pelo index.js)
async function verificarPendenciasExpiradas(client) {
  for (const guild of client.guilds.cache.values()) {
    const store = loadStore(guild.id);
    const agora = Date.now();
    const expirados = store.pendings.filter(p => p.expiresAt && agora > p.expiresAt);

    if (expirados.length === 0) continue;

    for (const pending of expirados) {
      store.pendings = store.pendings.filter(p => p.id !== pending.id);

      const thread = await guild.channels.fetch(pending.threadId).catch(() => null);
      if (thread) {
        const embed = new EmbedBuilder()
          .setTitle('⌛ Pendência expirada')
          .setDescription(
            `O prazo de pagamento de **${pending.productName}** (R$ ${pending.finalValue.toFixed(2)}) expirou.\n` +
            `O ticket será arquivado. O cliente pode abrir um novo atendimento quando quiser. 🎫`
          )
          .setColor('#ED4245');
        await thread.send({ embeds: [embed] }).catch(() => {});
        setTimeout(() => thread.setArchived(true).catch(() => {}), 5000);
      }

      if (store.logs.privateChannelId) {
        const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
        if (logChannel) {
          const logEmbed = privateLogEmbed(
            store,
            '⌛ Pendência expirada',
            `**Produto:** ${pending.productName}\n**Cliente:** <@${pending.userId}>\n**Ticket:** <#${pending.threadId}>`
          );
          await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    }

    saveStore(guild.id, store);
  }
}

module.exports = {
  registrarPendente,
  pagamentoAprovado,
  cancelarPendente,
  finalizarCompra,
  handleReferencia,
  handleComprarTambem,
  verificarPendenciasExpiradas
};