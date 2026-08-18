// server.js
// Servidor HTTP simples usado como "keep-alive" para hospedagem gratuita.
// O UptimeRobot pinga esta URL a cada 5 minutos, mantendo o bot acordado.

const http = require('http');

const port = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Bot ${process.env.BOT_NAME || 'Innova Forn'} online!`);
}).listen(port, () => {
  console.log(`🔄 Servidor keep-alive rodando na porta ${port}`);
});