const express = require('express');
const path = require('path');
const qrcode = require('qrcode');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

// --- UNIVERSAL CONFIGURATION ---
// This is your Sheet ID.
const SHEET_ID = '1aOv6KJBw4nbbbyqtkTcDWt5TNnWL5ttRMuQpejWobxA';
// --- END OF CONFIGURATION ---

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// This function smartly chooses the right authentication method.
async function getAuthenticatedClient() {
    let auth;
    
    // Check if we are running on Vercel and have the Base64 secret.
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
        console.log("Authenticating with Vercel Base64 credentials...");
        // Decode the Base64 secret back into the original JSON text.
        const credentialsJson = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
        const credentials = JSON.parse(credentialsJson);
        auth = new GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
    } else {
        // If not on Vercel, we must be on a local computer. Use the credentials.json file.
        console.log("Authenticating with local credentials.json file...");
        const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
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
        throw new Error("Could not authenticate with Google. Check credentials and share settings.");
    }
}

async function getOrdersFromSheet(sheets) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:C', // Ensure your sheet tab is named "Sheet1"
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
        throw new Error(`Google Sheets Error: ${err.message}. Check SHEET_ID, Tab Name ('Sheet1'), and Share settings.`); 
    }
}

// All the routes below are correct.

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

