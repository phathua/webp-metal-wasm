import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  plugins: [
    {
      name: 'terminal-logger-plugin',
      configureServer(server) {
        server.middlewares.use('/api/log', (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const color = data.level === 'error' ? '\x1b[31m' : data.level === 'warn' ? '\x1b[33m' : '\x1b[36m';
                const time = new Date().toLocaleTimeString();
                console.log(`\x1b[35m[Mobile ${time}]\x1b[0m ${color}[${(data.level || 'INFO').toUpperCase()}]\x1b[0m ${data.msg}`);
              } catch {
                // Ignore parse errors
              }
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('ok');
            });
          } else {
            res.end();
          }
        });
      }
    }
  ],
  worker: {
    format: 'es'
  }
});
