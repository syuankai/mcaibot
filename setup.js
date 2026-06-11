#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function clearScreen() {
    process.stdout.write('\x1b[2J\x1b[H');
}

function color(s, c) {
    const codes = { green: 32, cyan: 36, yellow: 33, red: 31, bold: 1 };
    const code = codes[c] || 0;
    return `\x1b[${code}m${s}\x1b[0m`;
}

function title(t) {
    console.log(`\n${color('═'.repeat(50), 'cyan')}`);
    console.log(`  ${color(t, 'bold')}`);
    console.log(`${color('═'.repeat(50), 'cyan')}\n`);
}

async function main() {
    clearScreen();
    console.log(color('  ╔══════════════════════════════════════╗', 'cyan'));
    console.log(color('  ║     McAiBot 初始設定引導              ║', 'cyan'));
    console.log(color('  ╚══════════════════════════════════════╝', 'cyan'));
    console.log();

    const existing = fs.existsSync(path.join(__dirname, 'config.js'));
    if (existing) {
        const ans = await ask(color('偵測到現有 config.js，是否覆蓋？(y/N) ', 'yellow'));
        if (ans.toLowerCase() !== 'y') {
            console.log(color('\n保留現有設定，跳過。\n', 'cyan'));
            await runInstall();
            showNextSteps();
            rl.close();
            return;
        }
    }

    title('Minecraft 伺服器設定');

    const host = await ask(`  伺服器位址 ${color('(例: play.example.com)', 'yellow')}: `) || 'your.server.com';
    const port = await ask(`  伺服器埠號 ${color('(預設: 25565)', 'yellow')}: `) || '25565';
    const auth = (await ask(`  認證方式 ${color('(microsoft / offline, 預設: microsoft)', 'yellow')}: `) || 'microsoft').toLowerCase();
    const username = await ask(`  ${auth === 'offline' ? '玩家名稱' : 'Microsoft 帳號(email)'} ${color('(必填)', 'red')}: `);
    const version = await ask(`  Minecraft 版本 ${color('(預設: 1.21.11)', 'yellow')}: `) || '1.21.11';

    title('掃描區域設定');

    const x1 = await ask(`  resetPosition.X ${color('(預設: 160)', 'yellow')}: `) || '160';
    const y1 = await ask(`  resetPosition.Y ${color('(預設: 50)', 'yellow')}: `) || '50';
    const z1 = await ask(`  resetPosition.Z ${color('(預設: 0)', 'yellow')}: `) || '0';

    title('LLM 語意解析設定');

    console.log(`  支援類型: ${color('openai, claude, gemini, qwen, wenxin, azure, ollama', 'cyan')}\n`);
    const provider = (await ask(`  LLM 提供者 ${color('(預設: openai)', 'yellow')}: `) || 'openai').toLowerCase();
    let apiKey = '';
    if (provider !== 'ollama') {
        apiKey = await ask(`  API 金鑰 ${color('(必填)', 'red')}: `);
    }
    const model = await ask(`  模型名稱 ${color('(預設: gpt-4o-mini)', 'yellow')}: `) || 'gpt-4o-mini';
    const baseUrl = await ask(`  API 位址 ${color('(預設: https://api.openai.com/v1)', 'yellow')}: `) || 'https://api.openai.com/v1';

    title('寫入設定');

    const cfg = `const config = {
    host: ${JSON.stringify(host)},
    port: ${Number(port) || 25565},
    username: ${JSON.stringify(username)},
    version: ${JSON.stringify(version)},
    auth: ${JSON.stringify(auth)},
    semanticParser: {
        providerType: ${JSON.stringify(provider)},
        baseUrl: ${JSON.stringify(baseUrl)},
        model: ${JSON.stringify(model)},
        apiKey: ${JSON.stringify(apiKey)},
        timeoutMs: 20000
    },
    resetPosition: { x: ${Number(x1)}, y: ${Number(y1)}, z: ${Number(z1)} },
    gotoPathTimeoutMs: 24000,
    grabPathTimeoutMs: 24000,
    拟人: {
        enabled: false,
        lockDistance: 4,
        unlockDistance: 6,
        lookIntervalMs: 180
    },
    areas: {
        left: { name: '全物品左侧', min: {x: 149, y: 43, z: -74}, max: {x: 173, y: 63, z: -8} },
        right: { name: '全物品右侧', min: {x: 148, y: 43, z: 8}, max: {x: 173, y: 59, z: 89} },
        bulk: { name: '大宗仓库', min: {x: 175, y: 43, z: -19}, max: {x: 256, y: 101, z: 19} },
        unstackable: { name: '不可堆叠区', min: {x: 130, y: 43, z: 8}, max: {x: 143, y: 58, z: 89} }
    }
};

module.exports = config;

const requiredFields = ['host', 'username'];
const placeholderValues = ['your.server.com', ''];
const missing = requiredFields.filter(f => !config[f] || placeholderValues.includes(config[f]));
if (missing.length > 0) {
    console.warn('\\x1b[33m[配置] 請設定: ' + missing.join(', ') + '\\x1b[0m');
}
`;

    fs.writeFileSync(path.join(__dirname, 'config.js'), cfg, 'utf8');
    console.log(color('  ✓ config.js 已寫入\n', 'green'));

    await runInstall();
    showNextSteps();
    rl.close();
}

async function runInstall() {
    title('安裝相依套件');
    const ans = await ask(color('  執行 npm install？(Y/n) ', 'yellow'));
    if (ans.toLowerCase() === 'n') {
        console.log(color('  跳過，稍後請手動執行 npm install\n', 'yellow'));
        return;
    }
    try {
        console.log(color('\n  正在安裝，請稍候...\n', 'cyan'));
        execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
        console.log(color('\n  ✓ 相依套件安裝完成\n', 'green'));
    } catch (e) {
        console.log(color(`\n  ✗ 安裝失敗: ${e.message}\n`, 'red'));
        console.log(color('  請手動執行 npm install\n', 'yellow'));
    }
}

function showNextSteps() {
    title('設定完成！接下來');
    console.log(`  ${color('1.', 'cyan')} 執行 ${color('npm start', 'bold')} 啟動機器人\n`);
    console.log(`  ${color('2.', 'cyan')} 開啟瀏覽器前往 ${color('http://localhost:3000', 'bold')}\n`);
    console.log(`  ${color('3.', 'cyan')} 首次訪問請設定管理密碼\n`);
    console.log(`  ${color('4.', 'cyan')} 在遊戲中輸入 ${color('!!kd 快遞20個白色混凝土~~', 'bold')} 測試空投\n`);
    console.log(color('═'.repeat(50), 'cyan'));
    console.log();
}

main().catch(e => {
    console.error(color(`\n錯誤: ${e.message}\n`, 'red'));
    process.exit(1);
});
