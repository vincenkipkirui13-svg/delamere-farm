const fs = require('node:fs');
const http = require('node:http');
const app = require('./app');
const settings = require('./config/settings');

for (const dir of [
  settings.paths.public,
  settings.paths.uploads,
  `${settings.paths.uploads}/animals`,
  `${settings.paths.uploads}/dairy`,
  `${settings.paths.uploads}/gallery`,
  settings.paths.siteUploads
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const server = http.createServer(app);
let shuttingDown = false;

server.on('error', (error) => {
  console.error('\nDelamere Farm server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${settings.port} is already in use. Close the other process or change PORT in .env.`);
  }
  process.exitCode = 1;
});

server.on('listening', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : settings.port;
  console.log('\n========================================');
  console.log('        DELAMERE FARM WEBSITE');
  console.log('========================================');
  console.log(`Website : http://localhost:${port}`);
  console.log(`Host    : ${settings.host}`);
  console.log(`Admin   : http://localhost:${port}/admin/login`);
  console.log('Status  : Server is running');
  console.log('Stop   : Press CTRL+C');
  console.log('========================================\n');
});

server.on('close', () => {
  if (!shuttingDown) {
    console.error('The web server closed unexpectedly.');
    process.exitCode = 1;
  }
});

server.listen(settings.port, settings.host);

process.on('SIGINT', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping Delamere Farm...');
  server.close(() => {
    console.log('Delamere Farm server stopped.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  console.error('\nUncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\nUnhandled promise rejection:', reason);
  process.exit(1);
});
