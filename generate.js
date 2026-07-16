// Netlify Function(稳定版)
// 设计要点:
// 1. 拆成两个动作,每次 HTTP 请求只做一次模型调用,远低于 Netlify 10 秒限制
//    action = "describe" : 视觉模型看照片(最多3张) → 文字描述
//    action = "compose"  : DeepSeek 根据描述写文案
// 2. 先向硅基流动拉取"当前可用模型清单",从候选里挑一个真实存在的,
//    不再靠报错试探;清单拉取失败时退回逐个尝试
// 3. 结果会被记住(函数热启动期间),后续请求零额外开销
//
// 必需环境变量:SILICONFLOW_API_KEY
// 可选环境变量:VISION_MODEL / TEXT_MODEL(手动指定则优先)

const BASE = "https://api.siliconflow.cn/v1";

const VISION_CANDIDATES = [
  process.env.VISION_MODEL,
  "Qwen/Qwen3.6-27B",
  "Qwen/Qwen3.5-397B-A17B",
  "Qwen/Qwen2.5-VL-32B-Instruct",
  "Qwen/Qwen2.5-VL-72B-Instruct",
  "Pro/Qwen/Qwen2.5-VL-7B-Instruct",
].filter(Boolean);

const TEXT_CANDIDATES = [
  process.env.TEXT_MODEL,
  "deepseek-ai/DeepSeek-V3.2",
  "deepseek-ai/DeepSeek-V4-Flash",
  "Pro/deepseek-ai/DeepSeek-V3.2",
  "deepseek-ai/DeepSeek-V3.1-Terminus",
  "deepseek-ai/DeepSeek-V3",
].filter(Boolean);

// 热启动缓存
let modelListCache = null; // Set<string> | null
let modelListAt = 0;
let goodVision = null;
let goodText = null;

function unavailableMsg(msg) {
  const m = String(msg).toLowerCase();
  return (
    m.includes("disabled") || m.includes("not exist") || m.includes("not available") ||
    m.includes("invalid model") || m.includes("no such model") || m.includes("model_not_found")
  );
}

async function fetchModelList(apiKey) {
  const now = Date.now();
  if (modelListCache && now - modelListAt < 10 * 60 * 1000) return modelListCache;
  try {
    const res = await fetch(BASE + "/models", {
      headers: { Authorization: "Bearer " + apiKey },
    });
    if (!res.ok) return modelListCache;
    const data = await res.json();
    const ids = new Set((data.data || []).map((m) => m.id));
    if (ids.size > 0) {
      modelListCache = ids;
      modelListAt = now;
    }
  } catch (e) {
    // 拉不到清单不致命,退回逐个尝试
  }
  return modelListCache;
}

async function callOnce(apiKey, body) {
  const res = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error && data.error.message) ||
      "HTTP " + res.status;
    const err = new Error(msg);
    err.modelIssue = unavailableMsg(msg);
    err.thinkingIssue = String(msg).toLowerCase().includes("enable_thinking");
    throw err;
  }
  return data.choices[0].message.content;
}

async function callSmart(apiKey, candidates, remembered, buildBody) {
  // 1) 优先用记住的可用模型
  // 2) 否则用平台清单挑一个真实存在的
  // 3) 清单不可用时,按候选顺序逐个尝试
  let ordered;
  if (remembered) {
    ordered = [remembered, ...candidates.filter((c) => c !== remembered)];
  } else {
    const list = await fetchModelList(apiKey);
    if (list) {
      const hit = candidates.filter((c) => list.has(c));
      ordered = hit.length ? hit : candidates;
    } else {
      ordered = candidates;
    }
  }

  let lastErr = null;
  for (const model of ordered) {
    for (const withFlag of [true, false]) {
      try {
        const body = buildBody(model);
        if (withFlag) body.enable_thinking = false; // 混合思考模型走快速模式,防超时
        const content = await callOnce(apiKey, body);
        return { content, model };
      } catch (err) {
        lastErr = err;
        if (err.thinkingIssue) continue; // 去掉 enable_thinking 再试同一个模型
        break;
      }
    }
    if (lastErr && lastErr.modelIssue) continue; // 模型不可用 → 下一个候选
    throw lastErr; // 密钥/余额等问题 → 直接上报
  }
  throw lastErr || new Error("当前没有可用的模型,请稍后再试");
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "服务器还没有配置密钥:请在 Netlify 环境变量中添加 SILICONFLOW_API_KEY,然后重新拖文件夹部署" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "请求格式不对" }) };
  }

  try {
    // ───────── 动作一:看照片 ─────────
    if (payload.action === "describe") {
      const images = (payload.images || []).slice(0, 3);
      if (!images.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "没有收到照片" }) };
      }
      const content = images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mediaType || "image/jpeg"};base64,${img.data}` },
      }));
      content.push({
        type: "text",
        text:
          images.length === 1
            ? "用中文简要描述这张照片:场景地点、人物(数量/大概年龄/表情动作)、主要物品、天气光线、整体氛围和值得一提的细节。120字以内,只描述,不评论。"
            : `这里有 ${images.length} 张同一场合的照片。用中文综合描述:整体场景与场合、人物(数量/大概年龄/表情动作)、主要物品、天气光线、氛围,以及每张照片各自值得一提的细节。160字以内,只描述,不评论。`,
      });

      const vis = await callSmart(apiKey, VISION_CANDIDATES, goodVision, (model) => ({
        model,
        max_tokens: 400,
        temperature: 0.3,
        messages: [{ role: "user", content }],
      }));
      goodVision = vis.model;
      return { statusCode: 200, headers, body: JSON.stringify({ description: vis.content }) };
    }

    // ───────── 动作二:写文案 ─────────
    if (payload.action === "compose") {
      const { platform, description, note } = payload;
      if (!platform || !description) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "缺少照片描述或平台信息" }) };
      }
      const noteLine = note ? `\n用户补充说明:${note}` : "";
      const prompt =
        platform === "wechat"
          ? `照片内容:${description}${noteLine}

请据此为一位普通中国用户写微信朋友圈文案。要求:
1. 写 3 条风格不同的候选:一条温暖真挚、一条轻松幽默、一条简短含蓄
2. 每条 1~3 句话,口语化自然,像真人发的朋友圈,不要营销腔
3. 可适当用 1~2 个 emoji,不要堆砌
4. 只输出 JSON:{"options": ["文案1", "文案2", "文案3"]},不要其他文字或代码块标记`
          : `照片内容:${description}${noteLine}

请据此为一位普通中国用户写一篇小红书帖子。要求:
1. 标题:15 字以内,吸引人但不标题党,可带 1 个 emoji
2. 正文:80~150 字,分 2~3 小段,口语化有真实感,可适当用 emoji
3. 话题:4~6 个相关话题,每个以 # 开头
4. 只输出 JSON:{"title": "标题", "body": "正文", "tags": ["#话题1", "#话题2"]},不要其他文字或代码块标记`;

      const txt = await callSmart(apiKey, TEXT_CANDIDATES, goodText, (model) => ({
        model,
        max_tokens: 600,
        temperature: 0.8,
        messages: [{ role: "user", content: prompt }],
      }));
      goodText = txt.model;

      const clean = txt.content.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      return { statusCode: 200, headers, body: JSON.stringify(parsed) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "未知的操作类型" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "生成失败:" + (err.message || "请再试一次") }) };
  }
};
