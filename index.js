const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "*");
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.get('/proxy/*', async (req, res) => {
    try {
        let targetUrl = req.url.replace('/proxy/', '');
        
        if (!targetUrl.startsWith('http')) {
             // Handle cases where query params might mess up the replace
             const fullUrl = req.originalUrl;
             const splitIndex = fullUrl.indexOf('/proxy/');
             if (splitIndex !== -1) {
                 targetUrl = fullUrl.substring(splitIndex + 7);
             }
        }
        
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        const isPlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('.mpd');

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        if (isPlaylist) {
            const response = await axios.get(targetUrl, {
                headers: headers,
                responseType: 'text',
                validateStatus: () => true 
            });

            if (response.status >= 400) {
                return res.status(response.status).send(response.data);
            }

            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const host = req.get('host');
            const proxyBase = `${protocol}://${host}/proxy/`;

            const rewrittenLines = response.data.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                
                if (trimmed.startsWith('http')) {
                    return proxyBase + trimmed;
                } else {
                    return proxyBase + baseUrl + trimmed;
                }
            });

            res.set('Content-Type', 'application/vnd.apple.mpegurl');
            res.send(rewrittenLines.join('\n'));

        } else {
            const response = await axios({
                method: 'get',
                url: targetUrl,
                headers: headers,
                responseType: 'stream',
                validateStatus: () => true,
                timeout: 10000
            });

            res.status(response.status);
            
            const forwardHeaders = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'last-modified', 'etag'];
            forwardHeaders.forEach(h => {
                if (response.headers[h]) {
                    res.set(h, response.headers[h]);
                }
            });

            response.data.pipe(res);
            
            response.data.on('error', (err) => {
                console.error('Stream Error', err);
                res.end();
            });
        }

    } catch (error) {
        console.error(error.message);
        if (!res.headersSent) {
            res.status(500).send('Proxy Error');
        }
    }
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
