const express = require('express');
const path = require('path');
const qrcode = require('qrcode');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const serverless = require('serverless-http');

// --- UNIVERSAL CONFIGURATION ---
const SHEET_ID = '1aOv6KJBw4nbbbyqtkTcDWt5TNnWL5ttRMuQpejWobxA'; // Your Sheet ID
const app = express();
const router = express.Router();

// This function smartly chooses the right authentication method.
async function getAuthenticatedClient() {
    let auth;
    
    // Check if we are running on Netlify by looking for Netlify's environment variables.
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
        console.log("Authenticating with Netlify Base64 credentials...");
        try {
            const credentialsJson = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
            const credentials = JSON.parse(credentialsJson);
            auth = new GoogleAuth({
                credentials,
                scopes: 'https://www.googleapis.com/auth/spreadsheets',
            });
        } catch (err) {
            console.error("Failed to parse Base64 credentials from Netlify:", err);
            throw new Error("Could not parse Netlify credentials.");
        }
    } else {
        // If not on Netlify, we must be on a local computer. Use the credentials.json file.
        console.log("Authenticating with local credentials.json file...");
        // NOTE: The path is different now because server.js is in a subfolder.
        const CREDENTIALS_PATH = path.join(__dirname, '../../../credentials.json');
        auth = new GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
    }

    try {
        const authClient = await auth.getClient();
        return google.sheets({ version: 'v4', auth: authClient });
    } catch (err) {
        console.error("AUTHENTICATION FAILED:", err.message);
        throw new Error("Could not authenticate with Google.");
    }
}

async function getOrdersFromSheet(sheets) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:C',
        });
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];
        const headers = rows[0];
        return rows.slice(1).map(row => {
            let order = {};
            headers.forEach((header, index) => { order[header] = row[index]; });
            return order;
        });
    } catch (err) {
        console.error('GOOGLE SHEETS API ERROR:', err.message);
        throw new Error(`Google Sheets Error: ${err.message}.`); 
    }
}

// All your app's "routes" are now on this router object.

router.get('/orders', async (req, res) => {
    try {
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        const order = orders.find(o => o.order_id === orderId);
        if (order) { res.json(order); } 
        else { res.status(404).json({ error: 'Order not found' }); }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/generate-qr', async (req, res) => {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).send('Error: Please provide an order_id.');
    try {
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        const order = orders.find(o => o.order_id === order_id);
        if (!order) return res.status(404).send('Error: Order ID not found.');
        
        // This constructs the public URL for Netlify
        const domain = `https://${req.headers.host}`;
        const urlToEncode = `${domain}/${order.customer_type}.html?order_id=${order_id}`;
        
        qrcode.toBuffer(urlToEncode, { errorCorrectionLevel: 'H' }, (err, buffer) => {
            if (err) throw err;
            res.type('png').send(buffer);
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// This sets up the router to work with Netlify
app.use('/api', router);
app.use('/.netlify/functions/server', router);

// This makes the app exportable for Netlify
module.exports.handler = serverless(app);
