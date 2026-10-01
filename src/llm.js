/* ThaiWise - tutor com LLM (traga sua própria chave).
   A chave fica só no localStorage deste navegador (chave "thaiwise-llm") e vai direto do navegador para a API do provedor;
   nada passa por servidor do jogo. Provedores OpenAI-compatíveis usam o mesmo formato de chat. */
const LLM_KEY = "thaiwise-llm";
const PROVIDERS = {
  anthropic: { name: "Anthropic (Claude)", model: "claude-sonnet-4-5", fallback: ["claude-haiku-4-5"], url: "https://api.anthropic.com/v1/messages", kind: "anthropic" },
  openai:    { name: "OpenAI (GPT)", model: "gpt-4o-mini", fallback: ["gpt-4.1-mini"], url: "https://api.openai.com/v1/chat/completions", kind: "openai" },
  google:    { name: "Google (Gemini)", model: "gemini-2.5-flash", fallback: ["gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-flash-latest"], url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", kind: "google" },
  deepseek:  { name: "DeepSeek", model: "deepseek-chat", url: "https://api.deepseek.com/chat/completions", kind: "openai" },
  groq:      { name: "Groq (Llama, Meta)", model: "llama-3.3-70b-versatile", url: "https://api.groq.com/openai/v1/chat/completions", kind: "openai" },
  mistral:   { name: "Mistral", model: "mistral-small-latest", url: "https://api.mistral.ai/v1/chat/completions", kind: "openai" },
  openrouter:{ name: "OpenRouter (vários)", model: "meta-llama/llama-3.3-70b-instruct", url: "https://openrouter.ai/api/v1/chat/completions", kind: "openai" },
  custom:    { name: "OpenAI-compatível (URL própria)", model: "", url: "", kind: "openai" }
};
const LLM = {
  cfg() { try { return Object.assign({ provider: "anthropic", key: "", model: "", url: "" }, JSON.parse(localStorage.getItem(LLM_KEY) || "{}")); } catch (e) { return { provider: "anthropic", key: "", model: "", url: "" }; } },
  save(c) { try { localStorage.setItem(LLM_KEY, JSON.stringify(c)); } catch (e) { } },
  ready() { const c = LLM.cfg(); return !!c.key && (c.provider !== "custom" || !!c.url); },
  /* messages: [{role:"user"|"assistant", content}] ; devolve o texto da resposta */
  /* Tenta o modelo escolhido com até 3 tentativas (espera 1,5 s e 4 s) quando o provedor está sobrecarregado;
     se continuar indisponível, passa para os modelos reserva do mesmo provedor. onStatus informa a tela. */
  async chat(system, messages, onStatus) {
    const c = LLM.cfg(), P = PROVIDERS[c.provider] || PROVIDERS.anthropic, models = [c.model || P.model, ...(P.fallback || []).filter(m => m !== (c.model || P.model))];
    let last;
    for (const model of models) {
      for (let a = 0; a < 3; a++) {
        try { return await LLM.once(c, P, model, system, messages); }
        catch (e) { last = e; if (!e.retry) { if (e.status === 404) break; throw e; } if (a < 2) { onStatus && onStatus({ wait: true, model, attempt: a + 2 }); await new Promise(r => setTimeout(r, a ? 4000 : 1500)); } }
      }
      onStatus && onStatus({ fallback: true, model });
    }
    throw last;
  },
  fail(r, data) { const msg = (data && data.error && (data.error.message || data.error)) || ("HTTP " + r.status), e = new Error(typeof msg === "string" ? msg : JSON.stringify(msg)); e.status = r.status; e.retry = [408, 429, 500, 502, 503, 504, 529].includes(r.status) || /overload|high demand|unavailable|try again/i.test(e.message); return e; },
  async once(c, P, model, system, messages) {
    const url = c.provider === "custom" ? c.url : P.url;
    let r, data;
    if (P.kind === "anthropic") {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model, max_tokens: 700, system, messages }) });
      data = await r.json().catch(() => ({})); if (!r.ok) throw LLM.fail(r, data);
      return data.content.filter(x => x.type === "text").map(x => x.text).join("\n");
    }
    if (P.kind === "google") {
      r = await fetch(url.replace("{model}", model) + "?key=" + encodeURIComponent(c.key), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: 700 } }) });
      data = await r.json().catch(() => ({})); if (!r.ok) throw LLM.fail(r, data);
      return data.candidates[0].content.parts.map(p => p.text).join("\n");
    }
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + c.key }, body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "system", content: system }, ...messages] }) });
    data = await r.json().catch(() => ({})); if (!r.ok) throw LLM.fail(r, data);
    return data.choices[0].message.content;
  }
};
