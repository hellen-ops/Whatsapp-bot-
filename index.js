const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '!';
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const PORT = process.env.PORT || 3000;
const chatHistory = new Map();

// Express server for Render health check + QR viewing
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('WhatsApp bot is running ✅');
});

app.get('/qr', (req, res) => {
    if (fs.existsSync('./qr.png')) {
        res.sendFile(__dirname + '/qr.png');
    } else {
        res.send('QR not ready yet. Check logs.');
    }
});

app.listen(PORT, () => {
    console.log(`Health server running on port ${PORT}`);
});

// WhatsApp client - fixed for Render
const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "ai-bot"
    }),
    puppeteer: { 
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', async (qr) => {
    await qrcode.toFile('./qr.png', qr, { width: 400 });
    console.log('QR saved. Visit https://your-app.onrender.com/qr to scan');
});

client.on('ready', () => {
    console.log('✅ Bot is ready and connected!');
    if (fs.existsSync('./qr.png')) fs.unlinkSync('./qr.png');
});

client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
});

client.on('message', async (message) => {
    try {
        if (message.fromMe) return;
        
        const chatId = message.from;
        const text = message.body.trim();
        
        if (!text.startsWith(PREFIX)) return;
        
        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        
        console.log(`[${chatId}] ${command} ${args.join(' ')}`);

        if (command === 'ping') {
            await message.reply('pong 🏓');
        }
        
        else if (command === 'help') {
            const helpText = `*WhatsApp Bot Commands* 🤖

${PREFIX}ping - Check if bot is alive
${PREFIX}help - Show this message
${PREFIX}ask <question> - Chat with AI
${PREFIX}reset - Clear chat history
${PREFIX}echo <text> - Repeat text`;
            await message.reply(helpText);
        }
        
        else if (command === 'echo') {
            const echoText = args.join(' ');
            if (!echoText) return message.reply(`Usage: ${PREFIX}echo hello world`);
            await message.reply(echoText);
        }
        
        else if (command === 'reset') {
            chatHistory.delete(chatId);
            await message.reply('Chat history cleared 🧹');
        }
        
        else if (command === 'ask') {
            const question = args.join(' ');
            if (!question) return message.reply(`Usage: ${PREFIX}ask What is AI?`);
            
            if (!LLAMA_API_KEY) {
                return message.reply('AI not configured. Add LLAMA_API_KEY in Render env vars.');
            }

            await message.reply('Thinking... 🤔');

            if (!chatHistory.has(chatId)) {
                chatHistory.set(chatId, []);
            }
            let history = chatHistory.get(chatId);
            
            history.push({ role: 'user', content: question });
            if (history.length > 10) history = history.slice(-10);

            try {
                const response = await axios.post(
                    'https://api.llama.com/v1/chat/completions',
                    {
                        model: 'Llama-4-Maverick-17B-128E-Instruct-FP8',
                        messages: history,
                        max_tokens: 500,
                        temperature: 0.7
                    },
                    { headers: { 'Authorization': `Bearer ${LLAMA_API_KEY}` } }
                );

                const reply = response.data.completion_message.content.text;
                history.push({ role: 'assistant', content: reply });
                chatHistory.set(chatId, history);

                await message.reply(reply);
            } catch (err) {
                console.error('Llama API error:', err.response?.data || err.message);
                await message.reply('Sorry, AI request failed. Try again later.');
            }
        }
        
        else {
            await message.reply(`Unknown command. Type ${PREFIX}help to see available commands.`);
        }

    } catch (err) {
        console.error('Handler error:', err);
        message.reply('Oops, something went wrong.');
    }
});

client.initialize();
