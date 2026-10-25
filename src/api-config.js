export function chatEndpoint(value) {
  const base = new URL(value);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Base URL 需要是不含账号密码、查询参数的 HTTPS 地址');
  if (/^(localhost|127\.|10\.|192\.168\.|0\.|169\.254\.|\[)/.test(base.hostname)) throw new Error('请输入模型服务的公网 HTTPS 地址');
  let path = base.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  base.pathname = path;
  return base.href;
}

export function thinkingParameters(mode) {
  if (mode === 'disabled') return { thinking: { type: 'disabled' } };
  if (mode === 'qwen-disabled') return { enable_thinking: false };
  return {};
}
