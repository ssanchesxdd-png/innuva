// src/utils/attachmentCollector.js
// Coletor simples para aguardar anexo de imagem do usuário no chat.

const { MessageFlags } = require('discord.js');

// Mapa: "userId:channelId" -> { resolve, reject, timeout, context }
const pendingAttachments = new Map();

// Mapa por canal (log privado da staff): "channelId" -> { resolve, reject, timeout, context }
const pendingChannelAttachments = new Map();

// Aguarda QUALQUER imagem postada num canal (usado no log privado da staff).
async function waitForAttachmentInChannel(channel, timeoutMs = 180000) {
  const key = channel.id;
  console.log(`[anexo] aguardando imagem no canal ${key}`);

  if (pendingChannelAttachments.has(key)) {
    throw new Error('Já existe um upload pendente neste canal.');
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingChannelAttachments.delete(key);
      reject(new Error('Tempo esgotado. Nenhuma imagem foi enviada.'));
    }, timeoutMs);
    pendingChannelAttachments.set(key, { resolve, reject, timeout });
  });
}

function waitForAttachment(interaction, context, timeoutMs = 120000) {
  const key = `${interaction.user.id}:${interaction.channel.id}`;
  
  if (pendingAttachments.has(key)) {
    return Promise.reject(new Error('Já existe um upload pendente para você neste canal.'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAttachments.delete(key);
      reject(new Error('Tempo esgotado. Nenhuma imagem foi enviada.'));
    }, timeoutMs);

    pendingAttachments.set(key, { resolve, reject, timeout, context });
  });
}

// Aguarda anexo em uma thread (ticket), enviando prompt e aguardando anexo do staff
async function waitForAttachmentInThread(thread, staffId, timeoutMs = 180000) {
  const key = `${staffId}:${thread.id}`;
  
  if (pendingAttachments.has(key)) {
    throw new Error('Já existe um upload pendente para você neste ticket.');
  }

  // Envia mensagem pedindo a imagem
  const promptMsg = await thread.send({
    content: '📸 **Envie a foto de referência da conta** (anexo da imagem).\n*Tem 3 minutos para enviar.*',
    flags: MessageFlags.SuppressNotifications
  }).catch(() => null);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAttachments.delete(key);
      promptMsg?.delete().catch(() => {});
      reject(new Error('Tempo esgotado. Nenhuma imagem foi enviada.'));
    }, timeoutMs);

    pendingAttachments.set(key, { resolve, reject, timeout, context: { promptMsg } });
  });
}

function handleMessage(message) {
  // Ignora mensagens de bots
  if (message.author.bot) return false;

  // ---- Coleta por canal (log privado): qualquer imagem de humano resolve ----
  const canalPendente = pendingChannelAttachments.get(message.channel.id);
  if (canalPendente) {
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      const imageExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;
      const isImage = attachment.contentType?.startsWith('image/') || imageExtensions.test(attachment.name || '');

      if (!isImage) {
        message.reply({ content: '❌ O arquivo enviado não é uma imagem válida.' }).catch(() => {});
        return false;
      }

      clearTimeout(canalPendente.timeout);
      pendingChannelAttachments.delete(message.channel.id);
      canalPendente.resolve({
        url: attachment.url,
        name: attachment.name,
        contentType: attachment.contentType
      });
      return true;
    }
    // mensagem sem anexo enquanto aguardando — ignora silenciosamente
    return false;
  }

  // ---- Coleta por usuario+canal (fluxo publico) ----
  const key = `${message.author.id}:${message.channel.id}`;
  const pending = pendingAttachments.get(key);
  if (message.attachments.size === 0) return false;
  if (!pending) return false;
  
  const attachment = message.attachments.first();
  
  // Valida se é imagem
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;
  const isImage = attachment.contentType?.startsWith('image/') || imageExtensions.test(attachment.name);
  
  if (!isImage) {
    message.reply({ content: '❌ O arquivo enviado não é uma imagem válida.', flags: MessageFlags.Ephemeral });
    return false; // mantém pendente para tentar de novo
  }
  
  clearTimeout(pending.timeout);
  pendingAttachments.delete(key);
  
  // Apaga a mensagem de prompt se existir
  if (pending.context?.promptMsg) {
    pending.context.promptMsg.delete().catch(() => {});
  }
  
  pending.resolve({
    url: attachment.url,
    name: attachment.name,
    contentType: attachment.contentType
  });
  
  return true;
}

function cancelPending(userId, channelId) {
  const key = `${userId}:${channelId}`;
  const pending = pendingAttachments.get(key);
  if (pending) {
    clearTimeout(pending.timeout);
    if (pending.context?.promptMsg) {
      pending.context.promptMsg.delete().catch(() => {});
    }
    pendingAttachments.delete(key);
    return true;
  }
  return false;
}

module.exports = { waitForAttachment, handleMessage, cancelPending, waitForAttachmentInThread, waitForAttachmentInChannel };