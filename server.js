const express = require('express');
const https = require('https');

const app = express();

// Parse raw body voor ALLE requests
app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => data += chunk);
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});

const PROXY_SECRET = process.env.PROXY_SECRET;

// Fix newlines in PEM (Railway kan \n als literal string opslaan)
function fixPem(pem) {
  if (!pem) return '';
  return pem.replace(/\\n/g, '\n');
}

const PONTO_CERT = fixPem(process.env.PONTO_CERT);
const PONTO_KEY = fixPem(process.env.PONTO_KEY);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    certLoaded: PONTO_CERT.includes('BEGIN CERTIFICATE'),
    keyLoaded: PONTO_KEY.includes('BEGIN'),
    certLength: PONTO_CERT.length,
    keyLength: PONTO_KEY.length,
  });
});

// Proxy
app.all('/proxy/*', (req, res) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const path = '/' + req.params[0];
  console.log(`[PROXY] ${req.method} ${path}`);

  const options = {
    hostname: 'api.ibanity.com',
    port: 443,
    path: path,
    method: req.method,
    headers: {},
    cert: PONTO_CERT,
    key: PONTO_KEY,
    timeout: 30000,
  };

  // Forward relevante headers
  if (req.headers['authorization']) options.headers['Authorization'] = req.headers['authorization'];
  if (req.headers['content-type']) options.headers['Content-Type'] = req.headers['content-type'];
  options.headers['Accept'] = 'application/json';

  // Content-Length meegeven als er een body is
  if (req.rawBody && req.rawBody.length > 0) {
    options.headers['Content-Length'] = Buffer.byteLength(req.rawBody);
  }

  const proxyReq = https.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      console.log(`[PROXY] Response: ${proxyRes.statusCode} (${body.length} bytes)`);
      res.status(proxyRes.statusCode);
      if (proxyRes.headers['content-type']) {
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
      }
      res.send(body);
    });
  });

  proxyReq.on('timeout', () => {
    console.log('[PROXY] Request timeout!');
    proxyReq.destroy();
    res.status(504).json({ error: 'Gateway timeout' });
  });

  proxyReq.on('error', (err) => {
    console.log('[PROXY] Error:', err.message);
    console.log('[PROXY] Error code:', err.code);
    res.status(502).json({ error: err.message, code: err.code });
  });

  if (req.rawBody && req.rawBody.length > 0) {
    proxyReq.write(req.rawBody);
  }
  proxyReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ponto proxy running on port ${PORT}`);
  console.log(`Certificate valid: ${PONTO_CERT.includes('BEGIN CERTIFICATE')}`);
  console.log(`Key valid: ${PONTO_KEY.includes('BEGIN')}`);
  console.log(`Cert length: ${PONTO_CERT.length}`);
  console.log(`Key length: ${PONTO_KEY.length}`);
});
