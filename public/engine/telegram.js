// utils/requestLogger.js

// Memastikan konfigurasi global dimuat.
// Asumsi 'config.js' berada di '../settings/config'.
require('../settings/config'); 

const axios = require('axios');
const chalk = require('chalk'); // Untuk pewarnaan log konsol, pastikan sudah diinstal (npm install chalk)

// --- Helper untuk Logging Konsol yang Lebih Menarik ---
const logStyled = (message, type = 'info') => {
    let prefix = '';
    let colorFn = chalk.white; // Default color

    switch (type) {
        case 'success':
            prefix = chalk.green('✔ [SUCCESS]');
            colorFn = chalk.green;
            break;
        case 'error':
            prefix = chalk.red('✖ [ERROR]');
            colorFn = chalk.red;
            break;
        case 'warn':
            prefix = chalk.yellow('⚠ [WARNING]');
            colorFn = chalk.yellow;
            break;
        case 'info':
        default:
            prefix = chalk.blue('ℹ [INFO]');
            colorFn = chalk.blue;
            break;
    }
    console.log(`${prefix} ${colorFn(message)}`);
};

/**
 * Mengambil detail lengkap dari permintaan HTTP.
 * Termasuk IP, User Agent, Metode, URL, Query, Headers, Lokasi geografis, dan Timestamp.
 * Ini dirancang untuk bekerja dengan objek 'req' dari server HTTP seperti Express.js.
 * @param {Object} req - Objek permintaan HTTP.
 * @returns {Promise<Object>} Objek berisi detail permintaan yang telah diproses.
 */
async function getRequest(req) {
    // Mengambil IP dari header 'x-forwarded-for' (jika di belakang proxy) atau remoteAddress.
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Unknown IP';
    const userAgent = req.headers['user-agent'] || 'Unknown User-Agent';
    const method = req.method || 'Unknown Method';
    const url = req.originalUrl || req.url || 'Unknown URL';
    
    // Stringify query dan headers dengan format rapi (indentasi 2 spasi).
    const query = req.query ? JSON.stringify(req.query, null, 2) : '{}';
    const headers = req.headers ? JSON.stringify(req.headers, null, 2) : '{}';
    
    // Mendapatkan timestamp dalam zona waktu Indonesia (WIB).
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    
    let location = 'Lokasi tidak diketahui';
    try {
        logStyled(`Mencari detail lokasi untuk IP: ${ip}...`, 'info');
        // Menggunakan ip-api.com untuk geolokasi.
        // Meminta hanya field yang relevan untuk efisiensi.
        const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,lat,lon`);
        
        if (res.data && res.data.status === 'success') {
            location = `${res.data.city}, ${res.data.regionName}, ${res.data.country}`;
            logStyled(`Lokasi ditemukan: ${location} (Lat: ${res.data.lat}, Lon: ${res.data.lon})`, 'success');
        } else {
            // Menangani kasus di mana API ip-api.com gagal atau status bukan 'success'.
            location = `Gagal mendapatkan lokasi: ${res.data.message || 'Error tidak diketahui dari ip-api.com'}`;
            logStyled(`Gagal mencari lokasi IP: ${location}`, 'warn');
        }
    } catch (error) {
        // Menangani error jaringan atau error lainnya saat menghubungi ip-api.com.
        console.error(chalk.red(`[ERROR FETCH] Gagal mendapatkan lokasi dari ip-api.com untuk IP ${ip}: ${error.message}`));
        location = `Error saat mengambil lokasi: ${error.message}`;
        logStyled(`Terjadi kesalahan saat mencari lokasi.`, 'error');
    }
    
    return {
        ip,
        userAgent,
        method,
        url,
        query,
        headers,
        location,
        timestamp
    };
}

/**
 * Mengirim pesan notifikasi ke Telegram menggunakan Bot API.
 * Pesan akan diformat sebagai MarkdownV2 dan karakter khusus akan di-escape.
 * @param {string} rawMessage - Pesan mentah yang akan dikirim ke Telegram.
 * @returns {Promise<void>}
 */
async function sendTele(rawMessage) {
    // Validasi apakah token dan chatid Telegram sudah diatur secara global.
    if (!global.token || !global.chatid) {
        logStyled('Token bot Telegram atau Chat ID belum dikonfigurasi di global. Pesan tidak terkirim.', 'warn');
        return;
    }

    // Fungsi helper untuk meng-escape karakter khusus MarkdownV2.
    // Penting untuk mencegah error parsing di Telegram dan menjaga format.
    const escapeMarkdownV2 = (text) => {
        return text
            .replace(/_/g, '\\_')
            .replace(/\*/g, '\\*')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/~/g, '\\~')
            .replace(/`/g, '\\`')
            .replace(/>/g, '\\>')
            .replace(/#/g, '\\#')
            .replace(/\+/g, '\\+')
            .replace(/-/g, '\\-')
            .replace(/=/g, '\\=')
            .replace(/\|/g, '\\|')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\./g, '\\.')
            .replace(/!/g, '\\!');
    };

    // Escape pesan mentah sebelum dibungkus.
    const escapedMessage = escapeMarkdownV2(rawMessage);

    // Membungkus pesan dalam block kode MarkdownV2 untuk tampilan rapi di Telegram.
    const fullText = "```\n" + escapedMessage + "\n```"; 

    try {
        logStyled('Mencoba mengirim notifikasi ke Telegram...', 'info');
        const response = await axios.post(`https://api.telegram.org/bot${global.token}/sendMessage`, {
            chat_id: `${global.chatid}`,
            text: fullText,
            parse_mode: 'MarkdownV2'
        });

        if (response.data.ok) {
            logStyled('Notifikasi Telegram berhasil terkirim!', 'success');
        } else {
            // Log respons error dari Telegram API jika pengiriman gagal.
            logStyled(`Gagal mengirim notifikasi Telegram: ${response.data.description || 'Alasan tidak diketahui'}`, 'error');
        }
    } catch (error) {
        // Menangani error jaringan atau masalah koneksi saat mengirim ke Telegram.
        console.error(chalk.red(`[ERROR TELEGRAM] Error saat mengirim pesan Telegram: ${error.message}`));
        if (error.response) {
            // Log detail error dari respons HTTP jika ada (misal: 400 Bad Request, 401 Unauthorized).
            console.error(chalk.red(`[ERROR TELEGRAM RAW] Respons API Telegram: ${JSON.stringify(error.response.data)}`));
        }
        logStyled('Notifikasi Telegram gagal terkirim karena kesalahan koneksi atau API.', 'error');
    }
}

// Mengekspor fungsi-fungsi agar bisa diimpor dan digunakan oleh modul lain.
module.exports = { 
    getRequest, 
    sendTele 
};