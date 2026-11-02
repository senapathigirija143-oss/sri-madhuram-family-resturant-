require('dotenv').config();

const express = require('express');
const path = require('node:path');
const { app } = require('./api');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;

app.get('/', (req, res) => {
    res.sendFile(path.join(root, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(root, 'index.html'));
});

app.get('/style.css', (req, res) => {
    res.sendFile(path.join(root, 'style.css'));
});

app.listen(port, () => {
    console.log(`Sri Madhuram server listening on http://localhost:${port}`);
});
