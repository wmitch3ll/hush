// Hush on-device assistant (runs in a worker so the browser stays smooth).
// Gemma 4 (Google, Apache 2.0) via Transformers.js on the graphics chip (WebGPU). Pages and prompts never leave the device;
// the only network use is the one-time model download (cached afterwards).
import * as T from './vendor/transformers.mjs';
let proc = null, tok = null, model = null, busy = false, kind = 'mm';
const post = (t, x = {}) => self.postMessage({ t, ...x });
self.onmessage = async e => {
  const m = e.data || {};
  if (m.t === 'load') {
    try {
      const { env } = T; env.allowLocalModels = false; env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.wasmPaths = { mjs: new URL('./vendor/ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
        wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${m.ort}/dist/ort-wasm-simd-threaded.asyncify.wasm` };
      // Big file finished downloading → the rest is loading it onto the graphics chip ("almost there").
      const big = {};
      const prog = p => { if (!p) return; if (p.status === 'progress' && p.total) { big[p.file] = p.total; post('progress', { file: String(p.file || ''), loaded: p.loaded, total: p.total }); }
        if (p.status === 'done' && (big[p.file] || 0) > 150e6) post('stage', { s: 'warm' }); };
      kind = m.kind === 'lm' ? 'lm' : 'mm';
      if (kind === 'lm') {
        // Text-only model: just the tokenizer and the language model — far less memory than Gemma 4's image/audio parts.
        tok = await T.AutoTokenizer.from_pretrained(m.model, { progress_callback: prog });
        model = await T.AutoModelForCausalLM.from_pretrained(m.model, { dtype: 'q4f16', device: 'webgpu', progress_callback: prog });
      } else {
        proc = await T.AutoProcessor.from_pretrained(m.model, { progress_callback: prog }); tok = proc.tokenizer;
        const Cls = T.Gemma4ForConditionalGeneration || T.AutoModelForImageTextToText || T.AutoModelForCausalLM;
        model = await Cls.from_pretrained(m.model, { dtype: 'q4f16', device: 'webgpu', progress_callback: prog });
      }
      post('ready');
    } catch (err) { post('error', { e: String(err && err.message || err).slice(0, 300) }); }
  }
  if (m.t === 'ask') {
    if (!model) return post('error', { id: m.id, e: 'The assistant isn’t loaded' });
    if (busy) return post('error', { id: m.id, e: 'Still answering the last question' });
    busy = true;
    try {
      let inputs;
      if (kind === 'lm') {
        // Smaller model, smaller window: keep the prompt to what it (and a phone's memory) can handle.
        inputs = tok.apply_chat_template([{ role: 'user', content: String(m.prompt).slice(0, 12000) }], { add_generation_prompt: true, return_dict: true });
      } else {
        const messages = [{ role: 'user', content: [{ type: 'text', text: String(m.prompt).slice(0, 30000) }] }];
        const prompt = proc.apply_chat_template(messages, { enable_thinking: false, add_generation_prompt: true });
        inputs = await proc(prompt, null, null, { add_special_tokens: false });
      }
      const streamer = new T.TextStreamer(tok, { skip_prompt: true, skip_special_tokens: true, callback_function: x => post('tok', { id: m.id, x }) });
      await model.generate({ ...inputs, max_new_tokens: Math.min(1024, m.max || 500), do_sample: false, streamer });
      post('done', { id: m.id });
    } catch (err) { post('error', { id: m.id, e: String(err && err.message || err).slice(0, 300) }); }
    busy = false;
  }
};
