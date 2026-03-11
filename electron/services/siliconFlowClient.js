const DEFAULT_MODELS = Object.freeze([
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'deepseek-ai/DeepSeek-V2.5'
]);

class SiliconFlowClient {
  constructor(configStore) {
    this.configStore = configStore;
  }

  async getAvailableModels(payload = {}) {
    const config = this.configStore.getFullConfig();
    const apiKeyInput = payload.apiKey;
    const apiKey = typeof apiKeyInput === 'string' && apiKeyInput.trim()
      ? apiKeyInput.trim()
      : this.configStore.getApiKey();
    const baseUrl = String(payload.baseUrl || config.ai.baseUrl || '').trim();

    if (!apiKey || !baseUrl) {
      return {
        ok: false,
        models: DEFAULT_MODELS.slice(),
        source: 'fallback'
      };
    }

    const requestUrl = `${baseUrl.replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));
      const models = Array.isArray(data?.data)
        ? data.data
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean)
        : [];

      if (!response.ok || models.length === 0) {
        return {
          ok: false,
          models: DEFAULT_MODELS.slice(),
          source: 'fallback'
        };
      }

      return {
        ok: true,
        models,
        source: 'remote'
      };
    } catch (_error) {
      return {
        ok: false,
        models: DEFAULT_MODELS.slice(),
        source: 'fallback'
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async testConnection(payload = {}) {
    const config = this.configStore.getFullConfig();

    const apiKeyInput = payload.apiKey;
    const apiKey = typeof apiKeyInput === 'string' && apiKeyInput.trim()
      ? apiKeyInput.trim()
      : this.configStore.getApiKey();

    const model = String(payload.model || config.ai.model || '').trim();
    const baseUrl = String(payload.baseUrl || config.ai.baseUrl || '').trim();

    if (!apiKey) {
      return {
        ok: false,
        error: '缺少 API Key，请先在 AI 配置中保存。'
      };
    }

    if (!model) {
      return {
        ok: false,
        error: '缺少模型名，请先填写模型名。'
      };
    }

    if (!baseUrl) {
      return {
        ok: false,
        error: '缺少 SiliconFlow Base URL。'
      };
    }

    const requestUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const startedAt = Date.now();

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0.2,
          max_tokens: 8
        }),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startedAt;
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
        return {
          ok: false,
          error: `连接失败: ${message}`,
          status: response.status,
          latencyMs
        };
      }

      const preview = data?.choices?.[0]?.message?.content || '';
      return {
        ok: true,
        latencyMs,
        model,
        responseId: data?.id || '',
        preview: String(preview).slice(0, 120)
      };
    } catch (error) {
      const timeoutError = error?.name === 'AbortError';
      return {
        ok: false,
        error: timeoutError ? '连接超时（15 秒）' : `请求异常: ${error.message}`
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  buildGreetingDraft(payload = {}) {
    const keyword = String(payload.keyword || '').trim() || '目标岗位';
    const city = String(payload.city || '').trim();
    const template = String(payload.greetingTemplate || 'default').trim() || 'default';
    const company = String(payload.company || '').trim() || '某公司';
    const cityText = city ? `（${city}）` : '';

    return {
      ok: true,
      implemented: false,
      template,
      message: '打招呼草稿接口已预留，当前返回本地占位文案（未调用模型）。',
      draft: `你好，我正在关注${company}${cityText}的${keyword}机会，期待进一步沟通。`
    };
  }
}

module.exports = {
  DEFAULT_MODELS,
  SiliconFlowClient
};
