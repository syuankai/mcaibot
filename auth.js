const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '.web_secret');
const AUTH_FILE = path.join(__dirname, '.web_auth');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

function getOrCreateSecret() {
    if (fs.existsSync(SECRET_FILE)) {
        return fs.readFileSync(SECRET_FILE, 'utf8').trim();
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, 'utf8');
    console.log('\x1b[36m[認證] 已生成金鑰 (.web_secret)\x1b[0m');
    return secret;
}

function isPasswordSet() {
    return fs.existsSync(AUTH_FILE);
}

function setPassword(password) {
    const secret = getOrCreateSecret();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt + secret, 100000, 64, 'sha512').toString('hex');
    const data = JSON.stringify({ salt, hash });
    fs.writeFileSync(AUTH_FILE, data, 'utf8');
    console.log('\x1b[36m[認證] 密碼已設定並加密儲存 (.web_auth)\x1b[0m');
}

function verifyPassword(password) {
    const secret = getOrCreateSecret();
    if (!fs.existsSync(AUTH_FILE)) return false;
    const { salt, hash: storedHash } = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    const hash = crypto.pbkdf2Sync(password, salt + secret, 100000, 64, 'sha512').toString('hex');
    return hash === storedHash;
}

function createToken(password) {
    const secret = getOrCreateSecret();
    const payload = JSON.stringify({ t: Date.now(), h: crypto.createHmac('sha256', secret).update(password).digest('hex') });
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(secret).digest().slice(0, 32), iv);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function verifyToken(token) {
    try {
        const secret = getOrCreateSecret();
        const parts = token.split(':');
        if (parts.length !== 2) return false;
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(secret).digest().slice(0, 32), iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        const { t } = JSON.parse(decrypted.toString('utf8'));
        return (Date.now() - t) < TOKEN_EXPIRY_MS;
    } catch {
        return false;
    }
}

function authMiddleware(req, res, next) {
    if (!isPasswordSet()) {
        return next();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未授權' });
    }
    if (!verifyToken(authHeader.slice(7))) {
        return res.status(401).json({ error: '令牌無效或已過期' });
    }
    next();
}

module.exports = {
    getOrCreateSecret,
    isPasswordSet,
    setPassword,
    verifyPassword,
    createToken,
    verifyToken,
    authMiddleware
};
