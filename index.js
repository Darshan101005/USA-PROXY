const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "*");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/proxy/*', async (req, res) => {
    try {
        let targetUrl = req.url.replace('/proxy/', '');
        if (targetUrl.startsWith('http:/') && !targetUrl.startsWith('http://')) {
            targetUrl = targetUrl.replace('http:/', 'http://');
        } else if (targetUrl.startsWith('https:/') && !targetUrl.startsWith('https://')) {
            targetUrl = targetUrl.replace('https:/', 'https://');
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (req.headers.range) headers['Range'] = req.headers.range;

        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: headers,
            responseType: 'stream',
            validateStatus: () => true,
            maxRedirects: 5,
            httpAgent: httpAgent,
            httpsAgent: httpsAgent
        });

        const finalUrl = response.request.res.responseUrl || targetUrl;
        const contentType = response.headers['content-type'] || '';
        
        if (contentType.includes('application/vnd.apple.mpegurl') || 
            contentType.includes('application/x-mpegurl') || 
            targetUrl.includes('.m3u8')) {

            let data = '';
            response.data.on('data', (chunk) => data += chunk);
            response.data.on('end', () => {
                const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                const protocol = req.headers['x-forwarded-proto'] || req.protocol;
                const host = req.get('host');
                const proxyBase = `${protocol}://${host}/proxy/`;
                
                const lines = data.split('\n');
                const rewritten = lines.map(line => {
                    const l = line.trim();
                    if (!l || l.startsWith('#')) return line;
                    if (l.startsWith('http')) return proxyBase + l;
                    return proxyBase + baseUrl + l;
                });

                res.set('Content-Type', 'application/vnd.apple.mpegurl');
                res.send(rewritten.join('\n'));
            });

        } else if (contentType.includes('dash+xml') || 
                   contentType.includes('application/xml') || 
                   targetUrl.includes('.mpd')) {

            let data = '';
            response.data.on('data', (chunk) => data += chunk);
            response.data.on('end', () => {
                const baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                const protocol = req.headers['x-forwarded-proto'] || req.protocol;
                const host = req.get('host');
                const proxyBase = `${protocol}://${host}/proxy/`;
                const fullProxyBase = proxyBase + baseUrl;

                if (data.includes('<BaseURL>')) {
                    data = data.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, url) => {
                        if (url.startsWith('http')) return `<BaseURL>${proxyBase}${url}</BaseURL>`;
                        return `<BaseURL>${proxyBase}${baseUrl}${url}</BaseURL>`;
                    });
                } else {
                    const insertionPoint = data.indexOf('<Period');
                    if (insertionPoint !== -1) {
                        const endOfTag = data.indexOf('>', insertionPoint) + 1;
                        data = data.slice(0, endOfTag) + `<BaseURL>${fullProxyBase}</BaseURL>` + data.slice(endOfTag);
                    } else {
                        data = data.replace('<MPD', `<MPD><BaseURL>${fullProxyBase}</BaseURL>`);
                    }
                }

                res.set('Content-Type', 'application/dash+xml');
                res.send(data);
            });

        } else {
            res.status(response.status);
            const allow = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'last-modified', 'etag'];
            allow.forEach(k => {
                if (response.headers[k]) res.set(k, response.headers[k]);
            });
            response.data.pipe(res);
        }

    } catch (e) {
        if (!res.headersSent) res.sendStatus(500);
    }
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
