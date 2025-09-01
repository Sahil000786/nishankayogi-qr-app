// This line loads your .env file for local testing
require('dotenv').config();

const express = require('express');
const path = require('path');
const qrcode = require('qrcode');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

// --- UNIVERSAL CONFIGURATION ---
// This code reads secrets from Vercel's Environment Variables OR your local .env file
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const RAW_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || ''; // Safety check
const PRIVATE_KEY = RAW_PRIVATE_KEY.replace(/\\n/g, '\n'); 
// --- END OF CONFIGURATION ---

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

async function getAuthenticatedClient() {
    if (!CLIENT_EMAIL || !PRIVATE_KEY) {
        throw new Error("Missing Google credentials. Check Vercel Environment Variables or local .env file.");
    }
    try {
        const auth = new GoogleAuth({
            credentials: {
                client_email: CLIENT_EMAIL,
                private_key: PRIVATE_KEY,
            },
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        const authClient = await auth.getClient();
        return google.sheets({ version: 'v4', auth: authClient });
    } catch (err) {
        console.error("AUTHENTICATION ERROR:", err.message);
        throw new Error("Could not authenticate. Check Vercel Environment Variables or local .env file.");
    }
}

async function getOrdersFromSheet(sheets) {
    if (!SHEET_ID) {
        throw new Error("Google Sheet ID is missing. Set it in Vercel Environment Variables or local .env file.");
    }
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
        throw new Error(`Google Sheets Error: ${err.message}. Check SHEET_ID and Share settings.`); 
    }
}

app.get('/api/orders', async (req, res) => {
    try {
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/generate-qr', async (req, res) => {
    const { order_id } = req.query;
    if (!order_id) return res.status(400).send('Error: Please provide an order_id.');
    try {
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        const order = orders.find(o => o.order_id === order_id);
        if (!order) return res.status(404).send('Error: Order ID not found.');
        
        const domain = req.headers.host.includes('localhost') 
            ? `http://${req.headers.host}` 
            : `https://${req.headers.host}`;
        const urlToEncode = `${domain}/${order.customer_type}.html?order_id=${order_id}`;
        
        qrcode.toBuffer(urlToEncode, { errorCorrectionLevel: 'H' }, (err, buffer) => {
            if (err) throw err;
            res.type('png').send(buffer);
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.get('/api/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const sheets = await getAuthenticatedClient();
        const orders = await getOrdersFromSheet(sheets);
        const order = orders.find(o => o.order_id === orderId);
        if (order) {
            res.json(order);
        } else {
            res.status(404).json({ error: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
});
