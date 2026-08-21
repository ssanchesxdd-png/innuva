// src/utils/attachmentCollector.js
// Coletor simples para aguardar anexo de imagem do usuário no chat.

const { MessageFlags } = require('discord.js');

// Mapa: "userId:channelId" -> { resolve, reject, timeout, context }
const pendingAttachments = new Map();

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
  // Ignora mensagens de bots e sem anexos
  if (message.author.bot || message.attachments.size === 0) return false;
  
  const key = `${message.author.id}:${message.channel.id}`;
  const pending = pendingAttachments.get(key);
  
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

module.exports = { waitForAttachment, handleMessage, cancelPending, waitForAttachmentInThread };