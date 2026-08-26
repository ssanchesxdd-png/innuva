// src/utils/pix.js
// Gerador de BR Code (Pix Copia-e-Cola, padrao EMV do Banco Central) e PNG.
//
// Monta o payload estatico:
//   00 formato | 26 info merchant (chave) | 52 MCC | 53 moeda BRL |
//   54 valor (opcional) | 58 pais | 59 nome | 60 cidade |
//   62 txid | 63 CRC16-CCITT (poly 0x1021, init 0xFFFF)
//
// Tudo calculado localmente — nenhuma chamada externa.

function crc16(hexStr) {
  let crc = 0xFFFF;
  for (const byte of Buffer.from(hexStr, 'latin1')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Campo TLV: ID (2 digitos) + tamanho (2 digitos) + valor
function campo(id, valor) {
  const v = String(valor ?? '');
  return `${id}${v.length.toString().padStart(2, '0')}${v}`;
}

// Remove acentos/simbolos e limita o tamanho (exigencia dos campos nome/cidade)
function sanitizarTexto(texto, maxLen) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
    .toUpperCase() || 'LOJA';
}

function gerarPayloadPix({ chave, nome, cidade, valor = 0 }) {
  if (!chave || !String(chave).trim()) {
    throw new Error('Chave Pix vazia.');
  }

  let payload =
    campo('00', '01') +
    campo('26',
      campo('00', 'BR.GOV.BCB.PIX') +
      campo('01', String(chave).trim().slice(0, 77))
    ) +
    campo('52', '0000') +
    campo('53', '986');

  if (valor && Number(valor) > 0) {
    payload += campo('54', Number(valor).toFixed(2));
  }

  payload +=
    campo('58', 'BR') +
    campo('59', sanitizarTexto(nome, 25)) +
    campo('60', sanitizarTexto(cidade || 'SAO PAULO', 15)) +
    campo('62', campo('05', '***'));

  return payload + campo('63', crc16(payload + '6304'));
}

// Gera o PNG do QR (usa Buffer direto — sem arquivos temporarios)
async function gerarQrBuffer(payload) {
  const QRCode = require('qrcode');
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512
  });
}

module.exports = { crc16, campo, sanitizarTexto, gerarPayloadPix, gerarQrBuffer };