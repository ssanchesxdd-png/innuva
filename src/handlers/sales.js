// src/handlers/sales.js
// Fluxo de vendas: registrar pendente, aprovar pagamento, cancelar, finalizar,
// enviar recibo "Compra Aprovada", botao "Referencia" e "Comprar tambem".

const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadStore, saveStore, generatePurchaseId } = require('../storage');
// require lazy para evitar dependencia circular com tickets.js
const encerrarCanalTicket = (...args) => require('./tickets').encerrarCanalTicket(...args);
const { referenciaContainer, privateLogContainer, publicSaleContainer } = require('../utils/embeds');
const { registrarUso } = require('./coupons');
const { aoConcluirPrimeiraCompra } = require('./roles');
const { publicarCards } = require('./publicar');
const { waitForAttachment, waitForAttachmentInChannel } = require('../utils/attachmentCollector');

// Cria a venda pendente (aguardando pagamento via Pix)
// Cria o registro de pendencia (expiravel), avisa cliente por DM e loga para a staff.
// NAO mexe em mensagens do ticket — quem chama controla a mensagem principal.
async function criarPendencia(store, guild, sessao) {
  const prazoMin = store.ticket?.pendingMinutes || 30;
  const pending = {
    id: generatePurchaseId(),
    threadId: sessao.threadId,
    userId: sessao.userId,
    productId: sessao.produtoId,
    productName: sessao.produtoName,
    quantity: sessao.quantidade,
    initialValue: sessao.initialValue,
    discount: sessao.discount,
    finalValue: sessao.finalValue,
    couponCode: sessao.couponCode || null,
    accountUsername: sessao.usuarioConta || null,
    pixKey: store.pixKey || null,
    expiresAt: Date.now() + prazoMin * 60000
  };

  store.pendings.push(pending);
  saveStore(guild.id, store);

  // DM pro cliente avisando do pagamento pendente
  const buyer = await guild.client.users.fetch(pending.userId).catch(() => null);
  if (buyer) {
    try {
      await buyer.send({
        components: [
          new ContainerBuilder()
            .setAccentColor(0xF0B232)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `**⏳ Aguardando seu pagamento — ${store.storeName}**\n\n` +
                `Olá <@${pending.userId}>!\n\n` +
                `Sua compra de **${pending.productName}** (R$ ${pending.finalValue.toFixed(2)}) está aguardando pagamento.\n\n` +
                `🏦 **Chave Pix:** \`${store.pixKey || '—'}\`\n` +
                `⏰ **Prazo:** ${prazoMin} minutos\n\n` +
                `Assim que pagar, envie o comprovante no seu ticket.`
              )
            )
        ],
        flags: [MessageFlags.IsComponentsV2]
      }).catch(() => {});
    } catch (err) {
      // DM fechada, ignora
    }
  }

  // Log privado
  if (store.logs.privateChannelId) {
    const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const logContainer = privateLogContainer(
        store,
        '⏳ Venda pendente registrada',
        `**Comprador:** <@${pending.userId}>\n` +
        `**Produto:** ${pending.productName} x${pending.quantity}\n` +
        `**Valor:** R$ ${pending.finalValue.toFixed(2)}\n` +
        (pending.couponCode ? `**Cupom:** \`${pending.couponCode}\`\n` : '') +
        `**Prazo:** ${prazoMin} min\n` +
        `**Ticket:** <#${pending.threadId}>`
      );
      await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
    }
  }

  return pending;
}

// Alerta de estoque baixo (uma vez por degrau; rearma quando repoe)
const LIMIAR_ESTOQUE = 2;
async function avisarEstoqueBaixo(store, guild, produto) {
  if (!produto) return;
  if (produto.stock > LIMIAR_ESTOQUE) {
    produto.alertaEnviado = false;
    return;
  }
  if (produto.alertaEnviado) return;
  produto.alertaEnviado = true;

  if (!store.logs.privateChannelId) return;
  const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
  if (!logChannel) return;

  const esgotado = produto.stock === 0;
  const container = new ContainerBuilder()
    .setAccentColor(esgotado ? 0xED4245 : 0xF0B232)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        esgotado
          ? `**🔴 ESGOTADO — ${produto.name}**\n\nO produto esgotou! Os cards publicos ja mostram como esgotado.\nReabasteça em /config > Vendas > Estoque.`
          : `**📉 Estoque baixo — ${produto.name}**\n\nRestam apenas **${produto.stock} unidade(s)**.\nReabasteça em /config > Vendas > Estoque antes de perder venda!`
      )
    );
  await logChannel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
}
// Staff clicou em "Pagamento Aprovado" — finaliza a venda
async function pagamentoAprovado(interaction, pendingId) {
  const store = loadStore(interaction.guildId);
  const idx = store.pendings.findIndex(p => p.id === pendingId);

  if (idx === -1) {
    return interaction.update({
      components: [new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Pendência não encontrada (pode já ter sido resolvida).'))
      ],
      flags: [MessageFlags.IsComponentsV2]
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
    await avisarEstoqueBaixo(store, interaction.guild, produto);
  }

  // Foto de referencia sera enviada pela staff depois, via botao no log privado
  const referenceImage = null;

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
    referenceImage,
    date: Date.now()
  };

  // Detecta a primeira compra ANTES de registrar no historico
  // (usado para conceder o cargo de Comprador)
  const primeiraCompra = !store.sales.history.some(c => c.buyerId === pending.userId);

  store.sales.history.push(compra);
  saveStore(interaction.guildId, store);

  // Cargo de "Comprador" na primeira compra concluida
  if (primeiraCompra) {
    await aoConcluirPrimeiraCompra(interaction.guild, store, pending.userId).catch(() => {});
  }

  // Atualiza o card do produto nos canais de venda (estoque caiu)
  await publicarCards(interaction.guild).catch(() => {});

  await finalizarCompra(interaction, store, compra);
}

// Finaliza a compra: recibo publico + DM + log privado + arquiva thread
async function finalizarCompra(interaction, store, compra) {
  const guild = interaction.guild;

  // Recibo publico em Container V2
  let publicMsgId = null;
  if (store.logs.publicChannelId) {
    const publicChannel = await guild.channels.fetch(store.logs.publicChannelId).catch(() => null);
    if (publicChannel) {
      const container = publicSaleContainer(store, compra);
      const publicMsg = await publicChannel.send({ components: [container], flags: [MessageFlags.IsComponentsV2] }).catch(err => {
        console.error('[recibo] Erro ao enviar recibo publico:', err);
        return null;
      });
      if (publicMsg) {
        publicMsgId = publicMsg.id;
        // Guarda a referencia para o botao "Registrar conta entregue" atualizar depois
        if (!store.receipts) store.receipts = {};
        store.receipts[compra.id] = { channelId: publicChannel.id, messageId: publicMsg.id };
      }
    }
  }

  // DM do recibo pro cliente
  const buyer = await guild.client.users.fetch(compra.buyerId).catch(() => null);
  if (buyer) {
    try {
      await buyer.send({
        components: [
          new ContainerBuilder()
            .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `**✅ Pagamento aprovado — ${store.storeName}**\n\n` +
                `Olá **${buyer.username}**!\n\n` +
                `Seu pagamento de **R$ ${compra.finalValue.toFixed(2)}** (${compra.productName}) foi aprovado.\n` +
                `A staff vai te entregar a conta neste ticket. Obrigado pela compra! ❤️`
              )
            )
        ],
        flags: [MessageFlags.IsComponentsV2]
      }).catch(() => {});
    } catch (err) {
      // DM fechada, ignora
    }
  }

  // Log privado + botoes para staff registrar entrega e foto
  if (store.logs.privateChannelId) {
    const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
    if (logChannel) {
      const rowEntrega = [];
      if (publicMsgId) {
        rowEntrega.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`entrega:modal:${compra.id}:${store.logs.publicChannelId}:${publicMsgId}`)
            .setLabel('Registrar conta entregue')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋')
        ));
      }
      if (!compra.referenceImage) {
        rowEntrega.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`foto:${compra.id}`)
            .setLabel('Enviar foto de referência')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📸')
        ));
      }

      const logContainer = privateLogContainer(
        store,
        '💰 Venda concluída',
        `**Comprador:** <@${compra.buyerId}>\n` +
        `**Produto:** ${compra.productName} x${compra.quantity}\n` +
        `**Valor:** R$ ${compra.finalValue.toFixed(2)}\n` +
        `**Pagamento:** ${compra.paymentMethod} ✅\n` +
        (compra.accountUsername ? `**Conta entregue:** \`${compra.accountUsername}\`\n` : '') +
        (compra.couponCode ? `**Cupom:** \`${compra.couponCode}\`\n` : '') +
        `**ID da Compra:** \`${compra.id}\`\n` +
        `**Ticket:** <#${compra.threadId || ''}>`,
        rowEntrega
      );

      await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
    }
  }

  await interaction.followUp({ content: `✅ Pagamento aprovado! Compra **${compra.id}** finalizada.`, flags: MessageFlags.Ephemeral }).catch(() => {});

}

// Staff clicou em "Finalizar Atendimento" — so entao o ticket e fechado
async function finalizarAtendimento(interaction) {
  const store = loadStore(interaction.guildId);
  if (!store.ticket.open?.[interaction.channel.id]) {
    return interaction.reply({ content: 'Isso só funciona dentro de um ticket.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: '🏁 Atendimento finalizado. Fechando o ticket em 5 segundos...' });
  await encerrarCanalTicket(interaction.guild, interaction.guildId, interaction.channel.id, 'Atendimento finalizado pela staff');
}

// Staff clicou em "Cancelar" — cancela a pendencia
async function cancelarPendente(interaction, pendingId) {
  const store = loadStore(interaction.guildId);
  const idx = store.pendings.findIndex(p => p.id === pendingId);

  if (idx === -1) {
    return interaction.update({
      components: [new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Pendência não encontrada.'))
      ],
      flags: [MessageFlags.IsComponentsV2]
    });
  }
  store.pendings.splice(idx, 1);
  saveStore(interaction.guildId, store);

  await interaction.update({
    components: [new ContainerBuilder()
      .setAccentColor(parseInt((store.color || '#5865F2').replace('#', ''), 16))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('✖️ Venda pendente cancelada.'))
    ],
    flags: [MessageFlags.IsComponentsV2]
  });

  await encerrarCanalTicket(interaction.guild, interaction.guildId, interaction.channel.id, 'Venda pendente cancelada');
}

// Botao "Referencia" no recibo publico — resposta ephemeral so pra quem clicou
async function handleReferencia(interaction, compraId) {
  const store = loadStore(interaction.guildId);
  const compra = store.sales.history.find(c => c.id === compraId);

  if (!compra) {
    return interaction.reply({ content: '❌ Compra não encontrada.', flags: MessageFlags.Ephemeral });
  }

  const container = referenciaContainer(store, compra);

  if (compra.referenceImage) {
    return interaction.reply({
      components: [container],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
    });
  }

  return interaction.reply({
    content: '⚠️ Esta compra não possui foto de referência.',
    components: [container],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
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

      // DM pro cliente avisando que o prazo acabou (sem poluir o chat do ticket)
      const buyer = await guild.client.users.fetch(pending.userId).catch(() => null);
      if (buyer) {
        try {
          await buyer.send({
            components: [
              new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(
                    `**⌛ Tempo esgotado**\n\n` +
                    `O prazo de pagamento de **${pending.productName}** (R$ ${pending.finalValue.toFixed(2)}) expirou.\n\n` +
                    `Seu ticket foi fechado. Você pode abrir um novo atendimento quando quiser. 🎫`
                  )
                )
            ],
            flags: [MessageFlags.IsComponentsV2]
          }).catch(() => {});
        } catch (err) {
          // DM fechada, ignora
        }
      }

      // Fecha o ticket automaticamente (independente de registro)
      const canalTicket = await guild.channels.fetch(pending.threadId).catch(() => null);
      if (canalTicket) {
        if (store.ticket.open?.[pending.threadId]) {
          delete store.ticket.open[pending.threadId];
        }
        await canalTicket.delete('Prazo de pagamento expirado').catch(() => {});
      }

      if (store.logs.privateChannelId) {
        const logChannel = await guild.channels.fetch(store.logs.privateChannelId).catch(() => null);
        if (logChannel) {
          const logContainer = privateLogContainer(
            store,
            '⌛ Pendência expirada — ticket fechado',
            `**Produto:** ${pending.productName}\n**Cliente:** <@${pending.userId}>\n**Ticket:** <#${pending.threadId}>`
          );
          await logChannel.send({ components: [logContainer], flags: [MessageFlags.IsComponentsV2] }).catch(() => {});
        }
      }
    }

    saveStore(guild.id, store);
  }
}

// Staff clicou em "Registrar conta entregue" — abre mini-modal
async function abrirModalEntrega(interaction, compraId) {
  const modal = new ModalBuilder()
    .setCustomId(`modal:entrega:${compraId}`)
    .setTitle('Conta entregue');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nick')
        .setLabel('Nick/login da conta entregue')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

// Submit do modal de entrega: atualiza a compra e re-renderiza o recibo publico
async function processarEntrega(interaction) {
  const store = loadStore(interaction.guildId);
  const compraId = interaction.customId.split(':')[2];
  const nick = interaction.fields.getTextInputValue('nick').trim();

  const compra = store.sales.history.find(c => c.id === compraId);
  if (!compra) {
    return interaction.reply({ content: '❌ Compra não encontrada.', flags: MessageFlags.Ephemeral });
  }

  compra.accountUsername = nick;
  saveStore(interaction.guildId, store);

  // Atualiza o recibo público se ainda existir
  const receiptRef = store.receipts?.[compraId];
  if (receiptRef) {
    const canal = await interaction.guild.channels.fetch(receiptRef.channelId).catch(() => null);
    if (canal) {
      const msg = await canal.messages.fetch(receiptRef.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ components: [publicSaleContainer(store, compra)] }).catch(() => {});
      }
    }
  }

  return interaction.reply({ content: `✅ Conta \`${nick}\` registrada na venda **${compraId}**.`, flags: MessageFlags.Ephemeral });
}

// Staff clicou em "Enviar foto de referencia" — pede anexo no canal da staff
async function enviarFotoReferencia(interaction, compraId) {
  const store = loadStore(interaction.guildId);
  const compra = store.sales.history.find(c => c.id === compraId);
  if (!compra) {
    const idsExistentes = store.sales.history.map(c => c.id).join(', ') || '(nenhuma)';
    console.error(`[foto] Compra ${compraId} nao encontrada. Historico: ${idsExistentes}`);
    return interaction.reply({ content: '❌ Compra não encontrada.', flags: MessageFlags.Ephemeral });
  }

  // Confirma o clique imediatamente
  await interaction.reply({ content: '📸 Aguardando o anexo da foto neste canal...', flags: MessageFlags.Ephemeral });

  const promptMsg = await interaction.channel.send(
    `📸 <@${interaction.user.id}> **Envie a foto de referência da venda \`${compraId}\`** (anexo da imagem). *3 minutos.*`
  ).catch(err => {
    console.error('[foto] Erro ao enviar prompt:', err);
    return null;
  });

  try {
    const attachment = await waitForAttachmentInChannel(interaction.channel, 180000);
    console.log(`[foto] Anexo recebido: ${attachment.url}`);

    compra.referenceImage = attachment.url;
    saveStore(interaction.guildId, store);

    // Apaga o prompt e confirma no canal da staff
    promptMsg?.delete().catch(() => {});
    await interaction.channel.send(`✅ Foto adicionada ao recibo da venda \`${compraId}\`.`).catch(() => {});

    // Atualiza o recibo publico com a foto
    let receiptRef = store.receipts?.[compraId];
    let targetMsg = null;

    if (receiptRef) {
      const canal = await interaction.guild.channels.fetch(receiptRef.channelId).catch(() => null);
      if (canal) targetMsg = await canal.messages.fetch(receiptRef.messageId).catch(() => null);
    }

    // Fallback: procura o recibo pelo ID da compra nos ultimos mensajes do canal publico
    if (!targetMsg && store.logs.publicChannelId) {
      const canalPublico = await interaction.guild.channels.fetch(store.logs.publicChannelId).catch(() => null);
      if (canalPublico) {
        const msgs = await canalPublico.messages.fetch({ limit: 30 }).catch(() => null);
        if (msgs) {
          targetMsg = msgs.find(m => m.components?.length && JSON.stringify(m.components).includes(compraId)) || null;
          if (targetMsg) {
            if (!store.receipts) store.receipts = {};
            store.receipts[compraId] = { channelId: canalPublico.id, messageId: targetMsg.id };
            saveStore(interaction.guildId, store);
          }
        }
      }
    }

    if (targetMsg) {
      await targetMsg.edit({ components: [publicSaleContainer(store, compra)] }).catch(err => console.error('[foto] msg edit:', err));
    } else if (store.logs.publicChannelId) {
      // Recibo antigo nao existe (venda anterior ao fix) — publica um novo com a foto
      const canalPublico = await interaction.guild.channels.fetch(store.logs.publicChannelId).catch(() => null);
      if (canalPublico) {
        const novoContainer = publicSaleContainer(store, compra);
        const novaMsg = await canalPublico.send({ components: [novoContainer], flags: [MessageFlags.IsComponentsV2] }).catch(err => {
          console.error('[foto] Erro ao publicar recibo novo:', err);
          return null;
        });
        if (novaMsg) {
          if (!store.receipts) store.receipts = {};
          store.receipts[compraId] = { channelId: canalPublico.id, messageId: novaMsg.id };
          saveStore(interaction.guildId, store);
          console.log(`[foto] Recibo novo publicado para ${compraId}`);
        }
      }
    } else {
      console.warn(`[foto] Recibo publico de ${compraId} nao encontrado para atualizar.`);
    }

    return interaction.followUp({ content: '✅ Foto de referência adicionada ao recibo!', flags: MessageFlags.Ephemeral });
  } catch (err) {
    promptMsg?.delete().catch(() => {});
    return interaction.followUp({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  criarPendencia,
  pagamentoAprovado,
  cancelarPendente,
  finalizarCompra,
  abrirModalEntrega,
  processarEntrega,
  enviarFotoReferencia,
  finalizarAtendimento,
  handleReferencia,
  handleComprarTambem,
  verificarPendenciasExpiradas
};
