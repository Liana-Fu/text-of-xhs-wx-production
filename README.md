# text-of-xhs-wx-production
it is a text for my mom, that she can use this html to product a text of some specific pictures. EASY TO USE!
# 📷 照片变文案 (Photo to Caption)

一个专为**不熟悉智能手机的人**(如长辈)设计的极简网页工具:

> 选择「微信朋友圈」或「小红书」→ 上传 1~3 张照片 → 十几秒后获得现成的文案 → 一键复制去发布

在线示例:https://text-cai.netlify.app/

## ✨ 特点

- **三步完成,零学习成本**:超大字体、超大按钮、一步一屏、步骤进度提示,专为老年用户设计
- **两个平台**:微信朋友圈(3 条不同风格候选文案)/ 小红书(标题 + 正文 + 话题标签,支持一键复制全部)
- **最多 3 张照片**:AI 综合理解同一场合的多张照片;每张可单独删除
- **稳定可靠**:
  - 照片在手机本地自动压缩,大照片也不会上传失败
  - "看图"和"写文案"拆成两次短请求,不触发 Netlify 10 秒超时
  - 调用前先获取平台可用模型清单,模型下架自动切换,无需改代码
  - 每一步自动重试,失败时显示具体原因
- **零成本起步**:Netlify 免费托管;AI 调用走硅基流动,一次生成约几分钱
- **密钥安全**:API 密钥保存在 Netlify 环境变量中,不出现在任何前端代码里

## 🧠 工作原理

DeepSeek 官方 API 只支持文字输入,不能直接"看"图片,因此采用两步接力,
均通过[硅基流动 SiliconFlow](https://siliconflow.cn) 完成(一个密钥搞定):

```
手机浏览器
   │  ① 本地压缩照片(≤1024px JPEG)
   ▼
Netlify Function (netlify/functions/generate.js)
   │
   ├── action: describe ──► 视觉模型 (Qwen-VL 系列) ──► 照片文字描述
   │
   └── action: compose  ──► DeepSeek 系列 ──► 朋友圈文案 / 小红书帖子 (JSON)
```

模型不写死:函数内置候选清单(新→旧),启动时向 `GET /v1/models`
拉取当前真实可用的模型,自动选择并缓存;平台下架旧模型不影响使用。

## 🚀 部署(约 5 分钟)

### 1. 获取硅基流动密钥
1. 注册 https://siliconflow.cn (国内手机号即可,新用户有免费额度;建议完成实名认证并充值少量金额,如 10 元)
2. 「API 密钥」页面新建密钥,复制(`sk-` 开头)

### 2. 部署到 Netlify

**方式 A:连接 GitHub(推荐,以后更新代码自动重新部署)**
1. Fork 本仓库(或把代码上传到你自己的 GitHub 仓库)
2. 登录 https://app.netlify.com → **Add new site → Import an existing project** → 选择 GitHub → 选中该仓库
3. 构建设置全部留默认(本项目无需构建),点 **Deploy**

**方式 B:拖拽部署(最简单)**
1. 下载本仓库代码(Code → Download ZIP)并解压
2. 把整个文件夹拖进 Netlify 的 Sites 页面

### 3. 配置密钥(关键,漏了就无法生成)
1. 站点 → **Site configuration → Environment variables → Add a variable**
   - Key: `SILICONFLOW_API_KEY`
   - Value: 你的密钥
2. 让密钥生效:
   - GitHub 方式:Deploys 页面 → **Trigger deploy → Deploy site**
   - 拖拽方式:把文件夹**再拖一次**

### 4. 测试
打开站点网址 → 选平台 → 传照片 → 「帮我写文案」。

## ⚙️ 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SILICONFLOW_API_KEY` | ✅ | 硅基流动 API 密钥 |
| `VISION_MODEL` | ❌ | 手动指定视觉模型(默认自动从候选清单选择) |
| `TEXT_MODEL` | ❌ | 手动指定文案模型(默认自动从候选清单选择) |

## 📁 目录结构

```
.
├── index.html                     # 全部前端(HTML+CSS+JS,单文件,无构建)
├── netlify.toml                   # Netlify 配置
├── netlify/functions/generate.js  # 后端函数:describe(看图) / compose(写文案)
└── docs/部署说明.md                # 面向非开发者的图文部署指南
```

## ❓ 常见问题

| 页面报错 | 原因与解决 |
|---|---|
| 没有配置密钥 | 环境变量没加 `SILICONFLOW_API_KEY`,或加完没重新部署 |
| 401 / 无效 | 密钥复制错误,重新粘贴,注意首尾空格 |
| balance is insufficient | 硅基流动余额不足:充值,或完成实名认证解锁赠送额度 |
| Model disabled / not exist | 候选模型全部下架(罕见):去硅基流动「模型广场」复制可用模型名,配置 `VISION_MODEL` / `TEXT_MODEL` |
| 网络没有连上 | 用户手机网络问题,重试即可 |

## 💰 成本参考

- Netlify:免费额度对个人使用绰绰有余
- 硅基流动:一次生成(看图 + 写文案)约几分钱人民币,10 元可用数百次

## 📄 License

[MIT](LICENSE) — 可自由使用、修改、分发。
