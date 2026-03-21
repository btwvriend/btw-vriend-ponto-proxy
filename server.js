const express = require('express');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Raw body voor form-urlencoded doorsturen
app.use((req, res, next) => {
  if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      req.rawBody = data;
      next();
    });
  } else {
    next();
  }
});

const PROXY_SECRET = process.env.PROXY_SECRET;
const PONTO_CERT = process.env.PONTO_CERT;
const PONTO_KEY = process.env.PONTO_KEY;

const IBANITY_HOST = 'api.ibanity.com';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', certLoaded: !!PONTO_CERT, keyLoaded: !!PONTO_KEY });
});

// Proxy alle requests naar Ibanity
app.all('/proxy/*', async (req, res) => {
  // Verificatie: alleen jouw edge functions mogen deze proxy gebruiken
  const authHeader = req.headers['x-proxy-secret'];
  if (authHeader !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Bouw het Ibanity pad op
  const ibanityPath = req.params[0]; // alles na /proxy/
  const targetUrl = `https://${IBANITY_HOST}/${ibanityPath}`;

  try {
    const url = new URL(targetUrl);

    // Bouw headers (forward relevante headers)
    const headers = {};
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    headers['Accept'] = req.headers['accept'] || 'application/json';

    // Bepaal body
    let body = null;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      if (req.rawBody) {
        body = req.rawBody;
      } else if (req.body && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
      }
    }

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: req.method,
      headers: headers,
      cert: PONTO_CERT,
      key: PONTO_KEY,
      // Belangrijk: dit zijn de mTLS opties
    };

    const proxyReq = https.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.status(proxyRes.statusCode);
        // Forward content-type
        if (proxyRes.headers['content-type']) {
          res.setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        res.send(data);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err.message);
      res.status(502).json({ error: 'Proxy request failed', details: err.message });
    });

    if (body) {
      proxyReq.write(body);
    }
    proxyReq.end();

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Internal proxy error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ponto proxy running on port ${PORT}`);
  console.log(`Certificate loaded: ${!!PONTO_CERT} (${PONTO_CERT?.length || 0} chars)`);
  console.log(`Private key loaded: ${!!PONTO_KEY} (${PONTO_KEY?.length || 0} chars)`);
});
