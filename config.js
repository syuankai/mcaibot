const config = {
    host: process.env.MC_HOST || 'yourdomainhere',
    port: Number(process.env.MC_PORT) || 25565,
    username: process.env.MC_USERNAME || 'microsoftaccountmail',
    version: process.env.MC_VERSION || '1.21.11',
    auth: process.env.MC_AUTH || 'microsoft',
    // 大模型語意解析配置（用於 !!kd ...~~）
    // 支援提供者：openai, claude, gemini, qwen, wenxin, azure, ollama
    semanticParser: {
        providerType: process.env.LLM_PROVIDER || 'openai',
        baseUrl: process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        apiKey: process.env.LLM_API_KEY || 'sk-xxx',
        timeoutMs: 20000
    },
    // 启动后自动复位坐标
    resetPosition: { x: 160, y: 50, z: 0 },
    // goto 指令寻路超时（毫秒）
    gotoPathTimeoutMs: 24000,
    // grab 指令寻路超时（毫秒），默认建议 8000~15000
    grabPathTimeoutMs: 24000,
    // 拟人行为：玩家靠近时锁定视角跟随（总开关名必须为“拟人”）
    拟人: {
        enabled: false,
        lockDistance: 4,
        unlockDistance: 6,
        lookIntervalMs: 180
    },
    // 定义不同的扫描区域
    areas: {
        left: { name: '全物品左侧', min: {x: 149, y: 43, z: -74}, max: {x: 173, y: 63, z: -8} },
        right: { name: '全物品右侧', min: {x: 148, y: 43, z: 8}, max: {x: 173, y: 59, z: 89} },
        bulk: { name: '大宗仓库', min: {x: 175, y: 43, z: -19}, max: {x: 256, y: 101, z: 19} },
        unstackable: { name: '不可堆叠区', min: {x: 130, y: 43, z: 8}, max: {x: 143, y: 58, z: 89} }
    }
};

module.exports = config;

// 啟動時基本驗證
const requiredFields = ['host', 'username'];
const placeholderValues = ['yourdomainhere', 'microsoftaccountmail'];
const missing = requiredFields.filter(f => !config[f] || placeholderValues.includes(config[f]));
if (missing.length > 0) {
    console.warn(`\x1b[33m[配置] 請先在 config.js 中設定: ${missing.join(', ')}\x1b[0m`);
}
