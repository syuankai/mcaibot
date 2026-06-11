/**
 * 多模型 LLM 提供者模組
 * 支援：OpenAI、Anthropic Claude、Google Gemini、阿里雲通義千問、百度文心、Azure OpenAI
 */

const config = require('./config');

// ==================== 系統提示詞 ====================
const SYSTEM_PROMPT = [
    '你是 Minecraft 倉庫空投指令解析器。',
    '你的任務是把玩家中文自然語言請求解析為結構化參數，供 !!kd 指令執行。',
    '只輸出 JSON，不要輸出任何額外文本。',
    '',
    '解析目標：',
    '1) itemName: 物品英文ID短名（例如 white_concrete, golden_apple）',
    '2) count: 正整數數量，預設 64',
    '3) confidence: 0~1 浮點數，表示你對解析結果的信心',
    '4) normalizedCommand: 規範化命令字串，必須是英文ID，格式為 "!!kd <english_item_id> <count>"',
    '5) explanation: 一句話解釋你如何從原文得出結果',
    '',
    '規則：',
    '- 用戶可能說「快遞/空投/送/給我來」等同義表達。',
    '- 如果文本裡沒有明確數量，count=64。',
    '- 如果數量不合法（負數、0、非數字）則按預設 64。',
    '- itemName 不能為空。',
    '- 返回 JSON Schema:',
    '{',
    '  "itemName": "string",',
    '  "count": 64,',
    '  "confidence": 0.95,',
    '  "normalizedCommand": "!!kd white_concrete 64",',
    '  "explanation": "..."',
    '}'
].join('\n');

// ==================== 基礎提供者類別 ====================
class BaseLLMProvider {
    constructor(options = {}) {
        this.apiKey = options.apiKey || '';
        this.baseUrl = options.baseUrl || '';
        this.model = options.model || '';
        this.timeoutMs = Number(options.timeoutMs || 10000);
    }

    ensureReady() {
        if (!this.apiKey) {
            throw new Error(`未配置 ${this.constructor.name} 的 API Key`);
        }
    }

    async fetchWithTimeout(url, options) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            return response;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`LLM 請求超時（>${this.timeoutMs}ms）`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    extractJsonText(rawText) {
        const text = String(rawText || '').trim();
        if (!text) {
            throw new Error('LLM 返回為空');
        }

        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first < 0 || last < 0 || last < first) {
            throw new Error(`LLM 返回非 JSON: ${text}`);
        }

        return text.slice(first, last + 1);
    }

    normalizeResult(payload) {
        const itemName = String(payload.itemName || '').trim();
        if (!itemName) {
            throw new Error('語意解析失敗：itemName 為空');
        }

        let count = Number(payload.count);
        if (!Number.isFinite(count) || count <= 0) {
            count = 64;
        }

        const confidenceNum = Number(payload.confidence);
        const confidence = Number.isFinite(confidenceNum)
            ? Math.max(0, Math.min(1, confidenceNum))
            : 0;

        const normalizedCommand = String(payload.normalizedCommand || `!!kd ${itemName} ${Math.floor(count)}`).trim();
        const explanation = String(payload.explanation || '').trim();

        return {
            itemName,
            count: Math.floor(count),
            confidence,
            normalizedCommand,
            explanation
        };
    }

    async parse(naturalText) {
        throw new Error('子類別必須實現 parse 方法');
    }
}

// ==================== OpenAI 相容提供者 ====================
class OpenAIProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    temperature: 0,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `請解析這句話：${input}` }
                    ]
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`LLM 請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== Anthropic Claude 提供者 ====================
class ClaudeProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl.replace(/\/$/, '')}/v1/messages`,
            {
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: 1024,
                    messages: [
                        { role: 'user', content: `${SYSTEM_PROMPT}\n\n請解析這句話：${input}` }
                    ]
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Claude 請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.content?.[0]?.text || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== Google Gemini 提供者 ====================
class GeminiProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const apiUrl = this.baseUrl.includes('/v1beta') 
            ? `${this.baseUrl.replace(/\/$/, '')}/models/${this.model}:generateContent?key=${this.apiKey}`
            : `${this.baseUrl.replace(/\/$/, '')}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

        const response = await this.fetchWithTimeout(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: SYSTEM_PROMPT },
                            { text: `請解析這句話：${input}` }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini 請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== 阿里雲通義千問提供者 ====================
class QwenProvider extends OpenAIProvider {
    // 通義千問使用 OpenAI 相容 API，直接繼承即可
}

// ==================== 百度文心提供者 ====================
class WenxinProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl.replace(/\/$/, '')}/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${this.model}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `請解析這句話：${input}` }
                    ]
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`文心請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.result || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== Azure OpenAI 提供者 ====================
class AzureOpenAIProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl.replace(/\/$/, '')}/openai/deployments/${this.model}/chat/completions?api-version=2024-02-01`,
            {
                method: 'POST',
                headers: {
                    'api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    temperature: 0,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `請解析這句話：${input}` }
                    ]
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Azure OpenAI 請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== 本地 Ollama 提供者 ====================
class OllamaProvider extends BaseLLMProvider {
    async parse(naturalText) {
        this.ensureReady();

        const input = String(naturalText || '').trim();
        if (!input) {
            throw new Error('語意解析輸入為空');
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl.replace(/\/$/, '')}/api/chat`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `請解析這句話：${input}` }
                    ],
                    stream: false
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama 請求失敗 ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data?.message?.content || '';
        const jsonText = this.extractJsonText(content);
        const payload = JSON.parse(jsonText);
        return this.normalizeResult(payload);
    }
}

// ==================== 提供者工廠 ====================
const PROVIDER_MAP = {
    openai: OpenAIProvider,
    claude: ClaudeProvider,
    gemini: GeminiProvider,
    qwen: QwenProvider,
    wenxin: WenxinProvider,
    azure: AzureOpenAIProvider,
    ollama: OllamaProvider
};

function createLLMProvider(providerType, options = {}) {
    const ProviderClass = PROVIDER_MAP[providerType.toLowerCase()];
    if (!ProviderClass) {
        throw new Error(`不支援的 LLM 提供者類型：${providerType}。支援的類型：${Object.keys(PROVIDER_MAP).join(', ')}`);
    }
    return new ProviderClass(options);
}

// ==================== 語意解析器（相容舊版介面）====================
class SemanticKdParser {
    constructor(options = {}) {
        const conf = config.semanticParser || {};
        
        // 自動偵測提供者類型
        this.providerType = options.providerType || process.env.LLM_PROVIDER || conf.providerType || 'openai';
        this.apiKey = options.apiKey || process.env.LLM_API_KEY || conf.apiKey || '';
        this.baseUrl = options.baseUrl || process.env.LLM_API_BASE_URL || conf.baseUrl || '';
        this.model = options.model || process.env.LLM_MODEL || conf.model || 'gpt-4o-mini';
        this.timeoutMs = Number(options.timeoutMs || process.env.LLM_TIMEOUT_MS || conf.timeoutMs || 10000);
        
        // 建立對應的提供者
        this.provider = createLLMProvider(this.providerType, {
            apiKey: this.apiKey,
            baseUrl: this.baseUrl,
            model: this.model,
            timeoutMs: this.timeoutMs
        });
    }

    ensureReady() {
        this.provider.ensureReady();
    }

    async parse(naturalText) {
        return this.provider.parse(naturalText);
    }
}

module.exports = {
    // 主要匯出
    SemanticKdParser,
    SYSTEM_PROMPT,
    
    // 提供者類別
    BaseLLMProvider,
    OpenAIProvider,
    ClaudeProvider,
    GeminiProvider,
    QwenProvider,
    WenxinProvider,
    AzureOpenAIProvider,
    OllamaProvider,
    
    // 工廠函數
    createLLMProvider,
    PROVIDER_MAP
};
